import type { Harness } from '@agentdeck/protocol';

export interface DetectResult {
  installed: boolean;
  version?: string;
  path?: string;
  /** One human-readable line for the startup banner. */
  note?: string;
}

export interface SpawnOpts {
  cwd: string;
  /** Initial prompt for the new session, when the deck provides one. */
  prompt?: string;
  model?: string;
  /** Harness-native session id to resume instead of starting fresh. */
  resumeSessionId?: string;
}

export interface ManagedSession {
  sessionId: string;
}

/**
 * One interface, per-session capability flags (SPEC §4). Adapters normalize
 * everything; the hub and deck stay harness-agnostic. `detect()` must verify
 * flags against the installed binary and degrade gracefully — never hard-fail
 * the hub because a harness changed a flag.
 */
export interface Adapter {
  harness: Harness;
  detect(): Promise<DetectResult>;
  spawn(opts: SpawnOpts): Promise<ManagedSession>;
  /** Observed mode (sessions the user starts in their own terminal), where supported. */
  attachObservers(): Promise<void>;
  dispose(): Promise<void>;
}
