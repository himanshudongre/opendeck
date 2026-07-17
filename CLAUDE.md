# AgentDeck — contributor guide for Claude Code

AgentDeck turns a phone/tablet browser into a physical-feeling control deck for AI coding
agents. Read `SPEC.md` for the full product spec and `DECISIONS.md` for choices the spec left
open. Both are source-of-truth documents — update `DECISIONS.md` when you make a new call.

## Commands

```sh
pnpm install            # workspace install (Node >= 20, pnpm 11)
pnpm dev                # hub in watch mode + deck dev server
pnpm build              # all packages, topological
pnpm lint               # eslint (typescript-eslint strict) + prettier --check
pnpm typecheck          # tsc --noEmit in every package
pnpm test               # vitest unit suites (protocol, hub, simulator, deck)
pnpm e2e                # Playwright suites in e2e/ (build first)
pnpm perf               # latency harness + bundle-size gate
```

Run single suites from a package: `pnpm --filter @agentdeck/protocol test`, or a single file:
`pnpm --filter agent-deck test -- src/core/replay-buffer.test.ts`.

## Architecture map

```
packages/protocol   zod schemas + types for every WS/REST message. Single source of truth.
                    Both hub and deck validate at the boundary. No runtime deps beyond zod.
packages/hub        Node CLI + server (published to npm as `agent-deck`).
  src/cli.ts          commander entry: default run, --demo, connect/disconnect, devices
  src/core/           session registry, event bus, replay ring buffer
  src/server/         fastify REST + static deck, ws fan-out, auth, pairing
  src/adapters/       Adapter interface + claude (managed/observed), codex, simulator glue
packages/deck       React 18 PWA (Vite + Tailwind v4 + zustand + motion). Custom design
                    system from SPEC §7 tokens — no component library.
packages/simulator  deterministic scripted fleet: demos, E2E, screenshots.
e2e/                Playwright projects (iPhone 14 / iPad / desktop) + latency harness.
```

Data flow: adapter → session registry → event bus → replay buffer → WS fan-out → deck store
→ widgets. The deck renders strictly from `Session` + events; harness-specific logic lives in
adapters only.

## Conventions

- TypeScript strict, ESM only. `any`, `@ts-ignore`, and `eslint-disable` comments are lint
  errors — fix the type, don't suppress it.
- No `console.*` outside `packages/hub/src/logger.ts`. Hub code logs via pino; terminal
  output for humans goes through the logger's `term` helpers.
- Workspace packages `@agentdeck/protocol` and `@agentdeck/simulator` are private; tsup
  bundles them into the published `agent-deck` package (`noExternal`).
- Adapters must verify CLI flags against the installed binary in `detect()` and degrade
  capabilities per session — never hard-fail the hub because a harness changed a flag.
- Adapter behavior is locked by the shared contract suite in
  `packages/hub/test/adapter-contract.ts`, replayed from recorded fixtures in
  `packages/hub/test/fixtures/` — CI never needs API keys or installed CLIs.
- UI copy: sentence case, plain verbs, no exclamation marks; buttons say what they do
  (SPEC §7.4). All motion respects `prefers-reduced-motion`.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Add a changeset for
  anything user-visible.
