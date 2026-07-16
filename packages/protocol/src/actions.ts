import { z } from 'zod';

export const ActionKindSchema = z.enum([
  'approve',
  'deny',
  'always_allow',
  'interrupt',
  'prompt_template',
  'resume',
  'kill',
  'new_session',
  'shell',
  'compact',
  'custom',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/**
 * Declarative action so the deck can bind any control to any behavior.
 * `shell` actions are defined only in hub config and always require an
 * explicit confirm tap on the deck (SPEC §8).
 */
export const ActionSchema = z.object({
  sessionId: z.string().min(1).optional(),
  kind: ActionKindSchema,
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type Action = z.infer<typeof ActionSchema>;
