import { z } from 'zod';
import type { CurrentTool, SessionStats } from '@opendeck/protocol';
import { truncate } from '../pretty.js';
import type { SessionSink } from '../claude/normalize.js';

/**
 * `codex exec --json` JSONL events. Recorded fixture shapes are the source of
 * truth (Codex was not installed on the build machine — SPEC §4 rule:
 * `detect()` re-verifies flags on machines that have it). Loose schemas:
 * unknown event or item types are ignored, never fatal.
 */
export const CodexItemSchema = z
  .object({
    id: z.string().optional(),
    item_type: z.string(),
    text: z.string().optional(),
    command: z.string().optional(),
    aggregated_output: z.string().optional(),
    exit_code: z.number().optional(),
    status: z.string().optional(),
    changes: z.array(z.object({ path: z.string(), kind: z.string() }).passthrough()).optional(),
    server: z.string().optional(),
    tool: z.string().optional(),
    query: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type CodexItem = z.infer<typeof CodexItemSchema>;

export const CodexEventSchema = z
  .object({
    type: z.string(),
    thread_id: z.string().optional(),
    item: CodexItemSchema.optional(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        cached_input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type CodexEvent = z.infer<typeof CodexEventSchema>;

function toolForItem(item: CodexItem): CurrentTool | undefined {
  switch (item.item_type) {
    case 'command_execution':
      return { name: 'Shell', detail: truncate(item.command ?? 'command', 80) };
    case 'file_change':
      return {
        name: 'Apply patch',
        detail: truncate((item.changes ?? []).map((change) => change.path).join(', '), 80),
      };
    case 'mcp_tool_call':
      return {
        name: 'MCP',
        detail: truncate([item.server, item.tool].filter(Boolean).join(' → ') || 'tool call', 80),
      };
    case 'web_search':
      return { name: 'Web search', detail: truncate(item.query ?? '', 80) };
    default:
      return undefined;
  }
}

/**
 * Folds Codex JSONL into normalized deck events. Same replay-tested shape
 * as the Claude normalizer.
 */
export class CodexStreamNormalizer {
  threadId: string | undefined;
  private readonly totals: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    elapsedMs: 0,
  };
  private turnStartedAt: number | undefined;

  constructor(
    private readonly sink: SessionSink,
    private readonly now: () => number = Date.now,
  ) {}

  handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return;
    }
    const parsed = CodexEventSchema.safeParse(json);
    if (!parsed.success) return;
    this.handle(parsed.data);
  }

  handle(event: CodexEvent): void {
    switch (event.type) {
      case 'thread.started':
        this.threadId = event.thread_id;
        return;
      case 'turn.started':
        this.turnStartedAt = this.now();
        this.sink.status('thinking');
        return;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        if (event.item) this.handleItem(event.type, event.item);
        return;
      case 'turn.completed': {
        const usage = event.usage;
        this.totals.inputTokens += (usage?.input_tokens ?? 0) + (usage?.cached_input_tokens ?? 0);
        this.totals.outputTokens += usage?.output_tokens ?? 0;
        this.totals.turns += 1;
        if (this.turnStartedAt !== undefined) {
          this.totals.elapsedMs += this.now() - this.turnStartedAt;
          this.turnStartedAt = undefined;
        }
        this.sink.stats({ ...this.totals });
        this.sink.status('done');
        return;
      }
      case 'turn.failed':
        this.sink.notice('error', event.error?.message ?? 'The Codex turn failed.');
        this.sink.status('error');
        return;
      case 'error':
        this.sink.notice('error', event.message ?? 'Codex reported an error.');
        this.sink.status('error');
        return;
      default:
        return;
    }
  }

  private handleItem(phase: string, item: CodexItem): void {
    if (item.item_type === 'reasoning') {
      if (phase !== 'item.completed') this.sink.status('thinking');
      return;
    }
    if (item.item_type === 'agent_message') {
      if (phase === 'item.completed' && item.text !== undefined && item.text.length > 0) {
        this.sink.transcript('assistant', item.text, true);
      }
      return;
    }
    if (item.item_type === 'error') {
      this.sink.notice('error', item.message ?? 'Codex reported an item error.');
      return;
    }
    const tool = toolForItem(item);
    if (!tool) return;
    if (phase === 'item.started') {
      this.sink.status('working', tool);
      this.sink.tool('start', tool);
    } else if (phase === 'item.completed') {
      const ok = item.exit_code === undefined ? item.status !== 'failed' : item.exit_code === 0;
      this.sink.tool('end', tool, ok);
    }
  }
}
