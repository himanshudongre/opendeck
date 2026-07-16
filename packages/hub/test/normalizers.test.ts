import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { ClaudeStreamNormalizer, type SessionSink } from '../src/adapters/claude/normalize.js';
import { CodexStreamNormalizer } from '../src/adapters/codex/events.js';
import { loadFixtureLines } from './adapter-contract.js';

interface SinkLog {
  sink: SessionSink;
  log: string[];
}

function logSink(): SinkLog {
  const log: string[] = [];
  return {
    log,
    sink: {
      patch: (patch) => log.push(`patch:${Object.keys(patch).join(',')}`),
      status: (status, tool) => log.push(`status:${status}${tool ? `:${tool.name}` : ''}`),
      transcript: (role, text) => log.push(`transcript:${role}:${text.slice(0, 20)}`),
      tool: (phase, tool, ok) => log.push(`tool:${phase}:${tool.name}:${String(ok)}`),
      stats: (stats) => log.push(`stats:${stats.inputTokens}:${stats.outputTokens}`),
      notice: (level, text) => log.push(`notice:${level}:${text.slice(0, 60)}`),
    },
  };
}

function claudeMsg(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe('ClaudeStreamNormalizer edge handling', () => {
  it('ignores unknown message types and non-array content', () => {
    const { sink, log } = logSink();
    const normalizer = new ClaudeStreamNormalizer(sink);
    normalizer.handle(claudeMsg({ type: 'status', status: 'compacting' }));
    normalizer.handle(claudeMsg({ type: 'assistant', message: { content: 'plain string' } }));
    normalizer.handle(claudeMsg({ type: 'user', message: { content: 'plain string' } }));
    normalizer.handle(claudeMsg({ type: 'system', subtype: 'plugin_install' }));
    expect(log).toEqual([]);
  });

  it('skips empty text blocks, unknown block types, and orphan tool results', () => {
    const { sink, log } = logSink();
    const normalizer = new ClaudeStreamNormalizer(sink);
    normalizer.handle(
      claudeMsg({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '' },
            { type: 'server_tool_use', name: 'web_search' },
          ],
        },
      }),
    );
    normalizer.handle(
      claudeMsg({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_unknown' }] },
      }),
    );
    expect(log).toEqual([]);
  });

  it('reports friendly messages for limit-stops', () => {
    for (const [subtype, needle] of [
      ['error_max_turns', 'turn limit'],
      ['error_max_budget_usd', 'budget limit'],
      ['error_during_execution', 'ended with an error'],
    ] as const) {
      const { sink, log } = logSink();
      const normalizer = new ClaudeStreamNormalizer(sink);
      normalizer.handle(
        claudeMsg({
          type: 'result',
          subtype,
          is_error: true,
          duration_ms: 10,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
      expect(log.some((line) => line.startsWith('notice:error') && line.includes(needle))).toBe(
        true,
      );
      expect(log.at(-1)).toBe('status:error');
    }
  });

  it('flags a failed tool result', () => {
    const { sink, log } = logSink();
    const normalizer = new ClaudeStreamNormalizer(sink);
    normalizer.handle(
      claudeMsg({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
    );
    normalizer.handle(
      claudeMsg({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }],
        },
      }),
    );
    expect(log).toContain('tool:end:Bash:false');
  });
});

describe('CodexStreamNormalizer edge handling', () => {
  it('ignores blank lines, garbage, and unknown events', () => {
    const { sink, log } = logSink();
    const normalizer = new CodexStreamNormalizer(sink);
    normalizer.handleLine('');
    normalizer.handleLine('   ');
    normalizer.handleLine('not json');
    normalizer.handleLine('{"no_type_field":true}');
    normalizer.handleLine('{"type":"session.created"}');
    expect(log).toEqual([]);
  });

  it('maps mcp calls, web searches, and file changes to tools', () => {
    const { sink, log } = logSink();
    const normalizer = new CodexStreamNormalizer(sink, () => 100);
    normalizer.handleLine(
      '{"type":"item.started","item":{"id":"i1","item_type":"mcp_tool_call","server":"github","tool":"create_pr"}}',
    );
    normalizer.handleLine(
      '{"type":"item.completed","item":{"id":"i1","item_type":"mcp_tool_call","server":"github","tool":"create_pr","status":"completed"}}',
    );
    normalizer.handleLine(
      '{"type":"item.started","item":{"id":"i2","item_type":"web_search","query":"vitest fake timers"}}',
    );
    normalizer.handleLine(
      '{"type":"item.completed","item":{"id":"i3","item_type":"file_change","changes":[{"path":"a.ts","kind":"update"}],"status":"failed"}}',
    );
    expect(log).toContain('tool:start:MCP:undefined');
    expect(log).toContain('tool:end:MCP:true');
    expect(log).toContain('tool:start:Web search:undefined');
    expect(log).toContain('tool:end:Apply patch:false');
  });

  it('treats item.updated as progress, not a new tool', () => {
    const { sink, log } = logSink();
    const normalizer = new CodexStreamNormalizer(sink);
    normalizer.handleLine(
      '{"type":"item.updated","item":{"id":"i1","item_type":"command_execution","command":"ls"}}',
    );
    expect(log).toEqual([]);
  });

  it('handles reasoning phases, empty messages, item errors, and bare errors', () => {
    const { sink, log } = logSink();
    const normalizer = new CodexStreamNormalizer(sink);
    normalizer.handleLine('{"type":"item.started","item":{"item_type":"reasoning"}}');
    normalizer.handleLine(
      '{"type":"item.completed","item":{"item_type":"reasoning","text":"done"}}',
    );
    normalizer.handleLine(
      '{"type":"item.completed","item":{"item_type":"agent_message","text":""}}',
    );
    normalizer.handleLine('{"type":"item.completed","item":{"item_type":"error"}}');
    normalizer.handleLine('{"type":"error"}');
    normalizer.handleLine('{"type":"turn.failed"}');
    expect(log).toEqual([
      'status:thinking',
      'notice:error:Codex reported an item error.',
      'notice:error:Codex reported an error.',
      'status:error',
      'notice:error:The Codex turn failed.',
      'status:error',
    ]);
  });

  it('accumulates usage across turns and tolerates missing usage', () => {
    const { sink, log } = logSink();
    let now = 0;
    const normalizer = new CodexStreamNormalizer(sink, () => now);
    normalizer.handleLine('{"type":"turn.started"}');
    now = 500;
    normalizer.handleLine(
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
    );
    normalizer.handleLine('{"type":"turn.completed"}');
    expect(log).toContain('stats:10:5');
    expect(log.filter((line) => line.startsWith('stats:'))).toHaveLength(2);
  });
});

describe('recorded claude fixture replay', () => {
  it('captures the native session id and full activity from the real stream', () => {
    const { sink, log } = logSink();
    const normalizer = new ClaudeStreamNormalizer(sink);
    for (const line of loadFixtureLines('claude-stream.jsonl')) {
      normalizer.handle(JSON.parse(line) as SDKMessage);
    }
    expect(normalizer.nativeSessionId).toBe('d57dfe8e-fb76-485d-86fc-c1ed78afedea');
    expect(log).toContain('status:thinking');
    expect(log).toContain('tool:start:Write:undefined');
    expect(log).toContain('tool:end:Bash:true');
    expect(log.at(-1)).toBe('status:done');
    expect(log.some((line) => line.startsWith('stats:') && !line.startsWith('stats:0'))).toBe(true);
  });
});
