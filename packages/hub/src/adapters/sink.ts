import type { Hub } from '../core/hub.js';
import type { SessionSink } from './claude/normalize.js';

/** Binds the normalizer-facing sink interface to one hub session. */
export function hubSink(hub: Hub, sessionId: string): SessionSink {
  return {
    patch: (patch) => {
      hub.patchSession(sessionId, patch);
    },
    status: (status, tool) => {
      hub.setStatus(sessionId, status, tool);
    },
    transcript: (role, text, done) => {
      hub.transcript(sessionId, role, text, done);
    },
    tool: (phase, tool, ok) => {
      hub.toolEvent(sessionId, phase, tool, ok);
    },
    stats: (stats) => {
      hub.updateStats(sessionId, stats);
    },
    notice: (level, text) => {
      hub.notice(sessionId, level, text);
    },
  };
}
