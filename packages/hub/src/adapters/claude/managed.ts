import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  query as sdkQuery,
  type CanUseTool,
  type Options,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { execa } from 'execa';
import type { Hub } from '../../core/hub.js';
import { newId } from '../../ids.js';
import { logger } from '../../logger.js';
import { diffForTool, prettyToolInput } from '../pretty.js';
import { hubSink } from '../sink.js';
import type { Adapter, DetectResult, ManagedSession, SpawnOpts } from '../types.js';
import { ClaudeStreamNormalizer } from './normalize.js';

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

/** Dial detents for the Claude thinking axis (SPEC §4.1). */
export const CLAUDE_THINKING_DETENTS: Record<string, number> = {
  off: 0,
  '4k': 4096,
  '16k': 16_384,
  '32k': 32_768,
};

/** Dial detents for the Claude model axis: tier alias → CLI model alias. */
export const CLAUDE_MODEL_DETENTS = ['haiku', 'sonnet', 'opus'];

/** Unbounded async queue driving the SDK's streaming-input mode. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiter: ((msg: SDKUserMessage) => void) | undefined;
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(msg);
    } else {
      this.buffered.push(msg);
    }
  }

  close(): void {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      const next = this.buffered.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) return;
      yield await new Promise<SDKUserMessage>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

export interface ClaudeManagedDeps {
  queryFn?: QueryFn;
  readFile?: (path: string) => string | undefined;
}

function defaultReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export class ClaudeManagedAdapter implements Adapter {
  readonly harness = 'claude';
  private readonly sessions = new Map<string, ClaudeManagedSession>();
  private readonly queryFn: QueryFn;
  private readonly readFile: (path: string) => string | undefined;

  constructor(
    private readonly hub: Hub,
    deps: ClaudeManagedDeps = {},
  ) {
    this.queryFn = deps.queryFn ?? sdkQuery;
    this.readFile = deps.readFile ?? defaultReadFile;
  }

  async detect(): Promise<DetectResult> {
    try {
      const result = await execa('claude', ['--version'], { timeout: 10_000 });
      const version = result.stdout.trim().split(' ')[0] ?? result.stdout.trim();
      return {
        installed: true,
        version,
        note: `Claude Code ${version} detected`,
      };
    } catch {
      return { installed: false, note: 'Claude Code not installed' };
    }
  }

  spawn(opts: SpawnOpts): Promise<ManagedSession> {
    const session = new ClaudeManagedSession(this.hub, this.queryFn, this.readFile, opts);
    this.sessions.set(session.id, session);
    session.start();
    return Promise.resolve({ sessionId: session.id });
  }

  attachObservers(): Promise<void> {
    // Observed sessions arrive through the hooks gateway; nothing to attach here.
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    for (const session of this.sessions.values()) session.kill();
    this.sessions.clear();
    return Promise.resolve();
  }
}

export class ClaudeManagedSession {
  readonly id = newId('claude');
  private readonly input = new InputQueue();
  private readonly abort = new AbortController();
  private readonly normalizer;
  private queryHandle: Query | undefined;

  constructor(
    private readonly hub: Hub,
    private readonly queryFn: QueryFn,
    private readonly readFile: (path: string) => string | undefined,
    private readonly opts: SpawnOpts,
  ) {
    this.normalizer = new ClaudeStreamNormalizer(hubSink(hub, this.id));
  }

  start(): void {
    const now = Date.now();
    this.hub.upsertSession(
      {
        id: this.id,
        hubId: this.hub.hubId,
        harness: 'claude',
        mode: 'managed',
        title:
          this.opts.prompt === undefined ? basename(this.opts.cwd) : titleFrom(this.opts.prompt),
        cwd: this.opts.cwd,
        ...(this.opts.model === undefined ? {} : { model: this.opts.model }),
        status: 'idle',
        statusSince: now,
        lastActivity: now,
        stats: { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, elapsedMs: 0 },
        capabilities: [
          'prompt',
          'interrupt',
          'approve',
          'set_effort',
          'set_model',
          'kill',
          'transcript',
        ],
      },
      {
        prompt: (text) => {
          this.prompt(text);
        },
        interrupt: async () => {
          await this.queryHandle?.interrupt();
          this.hub.setStatus(this.id, 'idle');
        },
        setEffort: async (payload) => {
          if (payload.axis === 'model') {
            if (!CLAUDE_MODEL_DETENTS.includes(payload.value)) {
              throw new Error(`Unknown model tier: ${payload.value}`);
            }
            await this.queryHandle?.setModel(payload.value);
            this.hub.patchSession(this.id, { model: payload.value });
            return payload.value;
          }
          if (payload.axis === 'thinking') {
            const tokens = CLAUDE_THINKING_DETENTS[payload.value];
            if (tokens === undefined) throw new Error(`Unknown thinking budget: ${payload.value}`);
            await this.queryHandle?.setMaxThinkingTokens(tokens === 0 ? 0 : tokens);
            return payload.value;
          }
          throw new Error('Claude sessions take the model and thinking axes.');
        },
        kill: () => {
          this.kill();
        },
      },
    );

    const options: Options = {
      cwd: this.opts.cwd,
      abortController: this.abort,
      canUseTool: this.canUseTool,
      settingSources: [],
      includePartialMessages: false,
      ...(this.opts.model === undefined ? {} : { model: this.opts.model }),
      ...(this.opts.resumeSessionId === undefined ? {} : { resume: this.opts.resumeSessionId }),
    };
    this.queryHandle = this.queryFn({ prompt: this.input, options });
    void this.consume(this.queryHandle);

    if (this.opts.prompt !== undefined) this.prompt(this.opts.prompt);
    if (this.opts.resumeSessionId !== undefined) {
      this.hub.notice(this.id, 'info', 'Session resumed');
    }
  }

  prompt(text: string): void {
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    });
    this.hub.transcript(this.id, 'user', text, true);
    this.hub.setStatus(this.id, 'thinking');
  }

  kill(): void {
    this.abort.abort();
    this.input.close();
    this.hub.removeSession(this.id);
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    const { resolution } = this.hub.requestPermission(this.id, {
      name: toolName,
      input: options.title ?? prettyToolInput(toolName, input),
      ...(() => {
        const diff = diffForTool(toolName, input, this.readFile);
        return diff === undefined ? {} : { diff };
      })(),
    });
    const decision = await resolution;
    if (decision === 'deny') {
      this.hub.setStatus(this.id, 'working');
      return { behavior: 'deny', message: 'Denied from the OpenDeck deck.' };
    }
    this.hub.setStatus(this.id, 'working');
    if (decision === 'always_allow' && options.suggestions !== undefined) {
      return { behavior: 'allow', updatedInput: input, updatedPermissions: options.suggestions };
    }
    return { behavior: 'allow', updatedInput: input };
  };

  private async consume(handle: Query): Promise<void> {
    try {
      for await (const msg of handle) {
        this.normalizer.handle(msg);
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        logger().error({ err: error, sessionId: this.id }, 'claude session stream failed');
        this.hub.notice(this.id, 'error', 'The Claude session crashed. Check the hub logs.');
        this.hub.setStatus(this.id, 'error');
      }
    }
  }
}

function titleFrom(prompt: string): string {
  const line = prompt.split('\n')[0] ?? prompt;
  return line.length <= 60 ? line : `${line.slice(0, 59)}…`;
}
