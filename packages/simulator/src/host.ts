import type {
  CurrentTool,
  PermissionResolution,
  Session,
  SessionStats,
  SessionStatus,
} from '@opendeck/protocol';

/**
 * What the simulator needs from its surroundings. The hub implements this in
 * its simulator glue; tests implement it with an event log. Keeping the
 * dependency pointed this way means `@opendeck/simulator` depends only on
 * the protocol.
 */
export interface SimHost {
  upsert(session: Session, controls: SimSessionControls): void;
  setStatus(sessionId: string, status: SessionStatus, tool?: CurrentTool): void;
  transcript(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    text: string,
    done: boolean,
  ): void;
  tool(sessionId: string, phase: 'start' | 'end', tool: CurrentTool, ok?: boolean): void;
  stats(sessionId: string, stats: SessionStats): void;
  notice(sessionId: string, level: 'info' | 'warn' | 'error', text: string): void;
  requestPermission(
    sessionId: string,
    tool: { name: string; input: string; diff?: string },
  ): Promise<PermissionResolution>;
  remove(sessionId: string): void;
}

/** Hooks the host can call back into a scripted session (deck actions). */
export interface SimSessionControls {
  prompt(text: string): void;
  interrupt(): void;
  setEffort(axis: string, value: string): string;
  kill(): void;
}
