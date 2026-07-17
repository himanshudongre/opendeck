import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { configPath } from './paths.js';

/**
 * `shell` actions are defined only here, never creatable from a client
 * (SPEC §8), and every invocation requires a confirm tap on the deck.
 */
export const CustomActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  icon: z.string().optional(),
});
export type CustomAction = z.infer<typeof CustomActionSchema>;

export const PromptTemplateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** May contain {{variables}} filled in on the deck before sending. */
  template: z.string().min(1),
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const HubConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3325),
  httpsPort: z.number().int().min(1).max(65535).default(3326),
  bind: z.enum(['lan', 'localhost']).default('lan'),
  auth: z.boolean().default(true),
  defaultTheme: z.enum(['graphite', 'workshop', 'void']).default('graphite'),
  customActions: z.array(CustomActionSchema).default([]),
  promptTemplates: z.array(PromptTemplateSchema).default([]),
});
export type HubConfig = z.infer<typeof HubConfigSchema>;

export type ConfigResult =
  { ok: true; config: HubConfig } | { ok: false; problems: string[]; config: HubConfig };

/**
 * Reads ~/.opendeck/config.json. A missing file is fine (all defaults);
 * an invalid one returns defaults plus friendly problem descriptions the CLI
 * prints — the hub never refuses to start over config it can recover from.
 */
export function loadConfig(): ConfigResult {
  const defaults = HubConfigSchema.parse({});
  let raw: string;
  try {
    raw = readFileSync(configPath(), 'utf8');
  } catch {
    return { ok: true, config: defaults };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      problems: [
        `${configPath()} is not valid JSON (${error instanceof Error ? error.message : 'parse error'}). Using defaults.`,
      ],
      config: defaults,
    };
  }

  const result = HubConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    return {
      ok: false,
      problems: result.error.issues.map(
        (issue) => `config.json ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
      config: defaults,
    };
  }
  return { ok: true, config: result.data };
}
