import { z } from 'zod';
import { CurrentToolSchema, SessionStatsSchema, SessionStatusSchema } from './session.js';

/** Status delta: the tile-level heartbeat of the whole product. */
export const StatusEventSchema = z.object({
  kind: z.literal('status'),
  sessionId: z.string().min(1),
  status: SessionStatusSchema,
  statusSince: z.number(),
  currentTool: CurrentToolSchema.optional(),
});

/**
 * Transcript delta. Only streamed to clients that subscribed to this session
 * (a Focus view is open) — never on the grid path (SPEC §3.4).
 */
export const TranscriptEventSchema = z.object({
  kind: z.literal('transcript'),
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
  /** True when this delta completes a message (paragraph flush, turn end). */
  done: z.boolean(),
});

/** Tool activity delta: powers the tile's "current tool" line and Focus activity feed. */
export const ToolEventSchema = z.object({
  kind: z.literal('tool'),
  sessionId: z.string().min(1),
  phase: z.enum(['start', 'end']),
  tool: CurrentToolSchema,
  /** Present on `end`: whether the tool call succeeded. */
  ok: z.boolean().optional(),
});

/** Stats delta: tokens, cost, turns, elapsed. */
export const StatsEventSchema = z.object({
  kind: z.literal('stats'),
  sessionId: z.string().min(1),
  stats: SessionStatsSchema,
});

/** One-line notices for the Ticker widget and Focus feed (e.g. "resumed", "compacted"). */
export const NoticeEventSchema = z.object({
  kind: z.literal('notice'),
  sessionId: z.string().min(1),
  level: z.enum(['info', 'warn', 'error']),
  text: z.string(),
});

export const SessionEventSchema = z.discriminatedUnion('kind', [
  StatusEventSchema,
  TranscriptEventSchema,
  ToolEventSchema,
  StatsEventSchema,
  NoticeEventSchema,
]);
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;
export type ToolEvent = z.infer<typeof ToolEventSchema>;
export type StatsEvent = z.infer<typeof StatsEventSchema>;
export type NoticeEvent = z.infer<typeof NoticeEventSchema>;
