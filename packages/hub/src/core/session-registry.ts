import type { Action, Session, SetEffortPayload } from '@opendeck/protocol';

/**
 * What an adapter can actually do for a live session. Every method is
 * optional — the session's `capabilities` array is the source of truth the
 * deck renders from, and the registry refuses calls the adapter didn't wire.
 */
export interface SessionController {
  prompt?(text: string): Promise<void> | void;
  interrupt?(): Promise<void> | void;
  /** Returns the value actually applied, for optimistic-UI reconciliation. */
  setEffort?(payload: SetEffortPayload): Promise<string> | string;
  kill?(): Promise<void> | void;
  resume?(): Promise<void> | void;
  /** Harness-specific extras (`compact`, `custom`). */
  runAction?(action: Action): Promise<void> | void;
}

interface Entry {
  session: Session;
  controller: SessionController;
}

export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();

  register(session: Session, controller: SessionController): void {
    this.entries.set(session.id, { session, controller });
  }

  remove(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.entries.get(sessionId)?.session;
  }

  controller(sessionId: string): SessionController | undefined {
    return this.entries.get(sessionId)?.controller;
  }

  /** Shallow-merges a patch and returns the updated session. */
  patch(sessionId: string, patch: Partial<Session>): Session | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    entry.session = { ...entry.session, ...patch };
    return entry.session;
  }

  list(): Session[] {
    return [...this.entries.values()].map((entry) => entry.session);
  }

  size(): number {
    return this.entries.size;
  }
}
