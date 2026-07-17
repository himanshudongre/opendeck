import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CurrentTool, Session, SessionStats, SessionStatus } from '@opendeck/protocol';
import { prettyToolDetail } from '../pretty.js';

/** The slice of hub powers a normalizer gets, pre-bound to one session. */
export interface SessionSink {
  patch(patch: Partial<Session>): void;
  status(status: SessionStatus, tool?: CurrentTool): void;
  transcript(role: 'user' | 'assistant' | 'system', text: string, done: boolean): void;
  tool(phase: 'start' | 'end', tool: CurrentTool, ok?: boolean): void;
  stats(stats: SessionStats): void;
  notice(level: 'info' | 'warn' | 'error', text: string): void;
}

/**
 * Folds the Agent SDK message stream into normalized deck events. Stateful
 * per session (tool_use id → tool, cumulative stats), pure with respect to
 * process management — the contract suite replays recorded fixtures through
 * this class with no SDK binary present.
 */
export class ClaudeStreamNormalizer {
  nativeSessionId: string | undefined;
  private readonly toolsInFlight = new Map<string, CurrentTool>();
  private readonly totals: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    turns: 0,
    elapsedMs: 0,
  };

  constructor(private readonly sink: SessionSink) {}

  handle(msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.nativeSessionId = msg.session_id;
          this.sink.patch({ model: msg.model });
        }
        return;
      case 'assistant':
        this.handleAssistant(msg.message.content);
        return;
      case 'user':
        this.handleUser(msg.message.content);
        return;
      case 'result':
        this.handleResult(msg);
        return;
      default:
        return;
    }
  }

  private handleAssistant(content: unknown): void {
    if (!Array.isArray(content)) return;
    for (const block of content as Record<string, unknown>[]) {
      switch (block.type) {
        case 'thinking':
          this.sink.status('thinking');
          break;
        case 'text':
          if (typeof block.text === 'string' && block.text.length > 0) {
            this.sink.transcript('assistant', block.text, true);
          }
          break;
        case 'tool_use': {
          const name = typeof block.name === 'string' ? block.name : 'Tool';
          const tool: CurrentTool = { name, detail: prettyToolDetail(name, block.input) };
          if (typeof block.id === 'string') this.toolsInFlight.set(block.id, tool);
          this.sink.status('working', tool);
          this.sink.tool('start', tool);
          break;
        }
        default:
          break;
      }
    }
  }

  private handleUser(content: unknown): void {
    if (!Array.isArray(content)) return;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const tool = this.toolsInFlight.get(block.tool_use_id);
      if (!tool) continue;
      this.toolsInFlight.delete(block.tool_use_id);
      this.sink.tool('end', tool, block.is_error !== true);
    }
  }

  private handleResult(msg: Extract<SDKMessage, { type: 'result' }>): void {
    const usage = msg.usage;
    this.totals.inputTokens +=
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    this.totals.outputTokens += usage.output_tokens;
    if (this.totals.costUsd !== undefined) {
      this.totals.costUsd = Math.round((this.totals.costUsd + msg.total_cost_usd) * 10000) / 10000;
    }
    this.totals.turns += msg.num_turns;
    this.totals.elapsedMs += msg.duration_ms;
    this.sink.stats({ ...this.totals });

    if (msg.subtype !== 'success' || msg.is_error) {
      this.sink.notice(
        'error',
        msg.subtype === 'success'
          ? 'The session ended with an error.'
          : friendlyResultError(msg.subtype),
      );
      this.sink.status('error');
    } else {
      this.sink.status('done');
    }
  }
}

function friendlyResultError(subtype: string): string {
  switch (subtype) {
    case 'error_max_turns':
      return 'Stopped: the session hit its turn limit.';
    case 'error_max_budget_usd':
      return 'Stopped: the session hit its budget limit.';
    default:
      return 'The session ended with an error.';
  }
}
