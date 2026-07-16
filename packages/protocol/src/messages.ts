import { z } from 'zod';
import { ActionSchema } from './actions.js';
import { SessionEventSchema } from './events.js';
import {
  PermissionRequestSchema,
  PermissionResolutionSchema,
  PermissionResolvedSchema,
} from './permissions.js';
import { SessionSchema } from './session.js';

// ---------------------------------------------------------------------------
// Envelope fields
// ---------------------------------------------------------------------------

const serverEnvelope = {
  v: z.number().int(),
  /** Monotonic per connection; replayed messages keep their original seq. */
  seq: z.number().int().nonnegative(),
  ts: z.number(),
} as const;

const clientEnvelope = {
  v: z.number().int(),
  /** Client-generated uuid, echoed back in `ack` / `error`. */
  id: z.string().min(1),
} as const;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  'version_mismatch',
  'unauthorized',
  'bad_message',
  'unknown_session',
  'unsupported',
  'rate_limited',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const HelloPayloadSchema = z.object({
  hubId: z.string().min(1),
  hubVersion: z.string().min(1),
  /** Current high-water sequence number; the client resumes from here next time. */
  seq: z.number().int().nonnegative(),
  sessions: z.array(SessionSchema),
  /**
   * fresh    — first connection, nothing to replay.
   * resumed  — the gap fit in the replay buffer; buffered events follow this hello.
   * snapshot — the gap outgrew the buffer; this hello IS the catch-up, nothing follows.
   */
  resume: z.enum(['fresh', 'resumed', 'snapshot']),
});
export type HelloPayload = z.infer<typeof HelloPayloadSchema>;

export const AckPayloadSchema = z.object({
  /** The client message id being acknowledged. */
  id: z.string().min(1),
  /** Reconciliation data, e.g. the effort value actually applied. */
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type AckPayload = z.infer<typeof AckPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  /** The client message id that caused this, when attributable. */
  id: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const ServerMsgSchema = z.discriminatedUnion('type', [
  z.object({ ...serverEnvelope, type: z.literal('hello'), payload: HelloPayloadSchema }),
  z.object({ ...serverEnvelope, type: z.literal('session_upsert'), payload: SessionSchema }),
  z.object({
    ...serverEnvelope,
    type: z.literal('session_removed'),
    payload: z.object({ sessionId: z.string().min(1) }),
  }),
  z.object({ ...serverEnvelope, type: z.literal('event'), payload: SessionEventSchema }),
  z.object({
    ...serverEnvelope,
    type: z.literal('permission_request'),
    payload: PermissionRequestSchema,
  }),
  z.object({
    ...serverEnvelope,
    type: z.literal('permission_resolved'),
    payload: PermissionResolvedSchema,
  }),
  z.object({ ...serverEnvelope, type: z.literal('ack'), payload: AckPayloadSchema }),
  z.object({ ...serverEnvelope, type: z.literal('error'), payload: ErrorPayloadSchema }),
  z.object({
    ...serverEnvelope,
    type: z.literal('pong'),
    payload: z.object({ t: z.number() }),
  }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;
export type ServerMsgType = ServerMsg['type'];
export type ServerPayload<T extends ServerMsgType> = Extract<ServerMsg, { type: T }>['payload'];

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export const SetEffortPayloadSchema = z.object({
  sessionId: z.string().min(1),
  /**
   * Which dial axis changed. `model` and `thinking` map to Claude tiers and
   * thinking budgets; `effort` maps to Codex reasoning effort. Adapters
   * validate values against what the installed harness supports.
   */
  axis: z.enum(['model', 'thinking', 'effort']),
  value: z.string().min(1),
});
export type SetEffortPayload = z.infer<typeof SetEffortPayloadSchema>;

export const ClientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    ...clientEnvelope,
    type: z.literal('subscribe'),
    /** Which session's transcript to stream; null = grid only (SPEC §3.4). */
    payload: z.object({ sessionId: z.string().min(1).nullable() }),
  }),
  z.object({ ...clientEnvelope, type: z.literal('action'), payload: ActionSchema }),
  z.object({
    ...clientEnvelope,
    type: z.literal('permission_response'),
    payload: z.object({
      requestId: z.string().min(1),
      resolution: PermissionResolutionSchema,
    }),
  }),
  z.object({ ...clientEnvelope, type: z.literal('set_effort'), payload: SetEffortPayloadSchema }),
  z.object({
    ...clientEnvelope,
    type: z.literal('prompt'),
    payload: z.object({ sessionId: z.string().min(1), text: z.string().min(1) }),
  }),
  z.object({
    ...clientEnvelope,
    type: z.literal('voice_prompt'),
    payload: z.object({
      sessionId: z.string().min(1),
      text: z.string().min(1),
      lang: z.string().optional(),
    }),
  }),
  z.object({
    ...clientEnvelope,
    type: z.literal('ping'),
    payload: z.object({ t: z.number() }),
  }),
  z.object({
    ...clientEnvelope,
    type: z.literal('resume'),
    payload: z.object({ lastSeq: z.number().int().nonnegative() }),
  }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;
export type ClientMsgType = ClientMsg['type'];
export type ClientPayload<T extends ClientMsgType> = Extract<ClientMsg, { type: T }>['payload'];
