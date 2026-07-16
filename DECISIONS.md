# Decisions

Small, dated records of choices the spec left open. One line of rationale each.

## Environment (Phase 0, 2026-07-17)

- Node v25.9.0 (satisfies ≥ 20), pnpm 11.13.1 (installed via `npm i -g pnpm`; corepack shim blocked by `/usr/local/bin` permissions).
- Claude Code CLI installed: `claude` 2.1.101 at `~/.local/bin/claude`. `--help` confirms `-p/--print`, `--output-format stream-json`, `--input-format stream-json`, `--resume <id>`, `--session-id`, `--permission-mode`, `--model`, `--settings` — all flags the adapters rely on.
- Codex CLI **not installed** on this machine. Per SPEC §4 build-time rule, the Codex adapter is built and tested entirely against recorded `codex exec --json` JSONL fixtures; `detect()` reports "not installed" here. `codex exec --help` could not be captured — flags are taken from the fixture set and re-verified by `detect()` at runtime on machines that have Codex.
- `@anthropic-ai/claude-agent-sdk` latest is 0.3.211 — used for managed Claude sessions.

## Version pins (Phase 0)

- **zod 3.25.x** — prompt pins zod v3 (zod 4 exists; not used).
- **React 18.3.x** — prompt pins React 18 (React 19 exists; not used).
- **TypeScript 5.9.x** — TS 7 (Go compiler) is out but typescript-eslint 8.x officially supports ≤ 5.9; strict-lint gates matter more than compiler speed here.
- Fastify 5.10, ws 8.21, execa 9, commander 15, pino 10, tsup 8.5, Vitest 4.1, Vite 8.1, Tailwind 4.3, motion 12, vite-plugin-pwa 1.3, Playwright 1.61, ESLint 10 + typescript-eslint 8, Changesets 2.31.

## Scaffold (Phase 1)

- ESLint pinned to 9.x (not 10.x): typescript-eslint 8's supported peer range; the whole quality gate rides on strict type-aware linting working flawlessly.
- Vite pinned to 7.x (not 8.x): vite-plugin-pwa 1.3 and the current Vitest/browser tooling are validated against Vite 7.
- `@agentdeck/protocol` and `@agentdeck/simulator` stay private and unbuilt (`main` → `src/index.ts`); tsup bundles them into the published `agentdeck` package via `noExternal`. One npm artifact, no internal version skew.
- Hub package version starts at 0.0.0 so the initial major changeset releases exactly 1.0.0.
- Lint gate = `eslint . && prettier --check .`; the banned-comment rule is `@eslint-community/eslint-comments/no-use` (bans all eslint directive comments, not just eslint-disable).
- Package `test` scripts are added only once a package has test files (empty Vitest suites exit non-zero; `passWithNoTests` would mask real misconfiguration).
- pnpm 11 wrote `allowBuilds`/`minimumReleaseAgeExclude` entries into pnpm-workspace.yaml (its supply-chain guard); esbuild's postinstall approved as required by Vite/tsup.

## Phase log

- [x] Phase 0 — Recon
- [x] Phase 1 — Scaffold
- [x] Phase 2 — Protocol
- [ ] Phase 3 — Hub core
- [ ] Phase 4 — Simulator
- [ ] Phase 5 — Real adapters
- [ ] Phase 6 — Deck
- [ ] Phase 7 — E2E + perf
- [ ] Phase 8 — Docs & release
- [ ] Phase 9 — Adversarial self-review
