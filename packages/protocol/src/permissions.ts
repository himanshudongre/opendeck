import { z } from 'zod';

export const PermissionResolutionSchema = z.enum(['approve', 'deny', 'always_allow']);
export type PermissionResolution = z.infer<typeof PermissionResolutionSchema>;

/**
 * A permission prompt surfaced to the deck. `input` is the pretty-printed tool
 * input; `diff` is a unified diff preview when the tool is a file edit.
 */
export const PermissionRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  tool: z.object({
    name: z.string().min(1),
    input: z.string(),
    diff: z.string().optional(),
  }),
  /** Which resolutions the adapter can actually honor for this request. */
  options: z.array(PermissionResolutionSchema).nonempty(),
  requestedAt: z.number(),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const PermissionResolvedSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  /** `dismissed` = the request became moot (session ended, superseded). */
  outcome: z.union([PermissionResolutionSchema, z.literal('dismissed')]),
  /** Where the decision came from: a deck tap, or the harness side (e.g. answered in the terminal). */
  source: z.enum(['deck', 'harness']),
});
export type PermissionResolved = z.infer<typeof PermissionResolvedSchema>;
