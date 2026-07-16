import { z } from 'zod';

export const HarnessSchema = z.enum(['claude', 'codex', 'opencode', 'simulator']);
export type Harness = z.infer<typeof HarnessSchema>;

/** managed = hub spawned it; observed = the user's own terminal, watched via hooks. */
export const SessionModeSchema = z.enum(['managed', 'observed']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionStatusSchema = z.enum([
  'idle',
  'thinking',
  'working',
  'waiting_input',
  'waiting_permission',
  'done',
  'error',
  'disconnected',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** What the adapter can do for THIS session — capability flags, not harness names. */
export const CapabilitySchema = z.enum([
  'prompt',
  'interrupt',
  'approve',
  'set_effort',
  'set_model',
  'resume',
  'kill',
  'transcript',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const CurrentToolSchema = z.object({
  name: z.string(),
  detail: z.string(),
});
export type CurrentTool = z.infer<typeof CurrentToolSchema>;

export const SessionStatsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  hubId: z.string().min(1),
  harness: HarnessSchema,
  mode: SessionModeSchema,
  title: z.string(),
  cwd: z.string(),
  repo: z.string().optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
  status: SessionStatusSchema,
  statusSince: z.number(),
  lastActivity: z.number(),
  currentTool: CurrentToolSchema.optional(),
  stats: SessionStatsSchema,
  capabilities: z.array(CapabilitySchema),
});
export type Session = z.infer<typeof SessionSchema>;
