# Contributing to OpenDeck

Thanks for wanting to make the deck better. This file is the practical
half; the product spec is [SPEC.md](SPEC.md) and the running log of choices
it left open is [DECISIONS.md](DECISIONS.md) — add a line there whenever you
make a new one.

## Setup

```sh
# Node >= 20 and pnpm 11
pnpm install
pnpm build          # all packages, topological (deck assets land in the hub)
pnpm dev            # hub in watch mode with the demo fleet
```

`pnpm dev` serves the deck from the hub's last build. For deck UI work with
hot reload, run the Vite dev server against a local hub:

```sh
node packages/hub/dist/cli.js --demo --no-auth &
VITE_HUB_URL=http://127.0.0.1:3325 pnpm --filter @opendeck/deck dev
```

## Test matrix

| Command          | What it runs                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`      | eslint (typescript-eslint strict, type-aware) + prettier --check                                                                                   |
| `pnpm typecheck` | `tsc --noEmit` in every package                                                                                                                    |
| `pnpm test`      | Vitest: protocol codecs, hub core, adapters (fixture replay), simulator, deck store/widgets — with coverage gates (hub+protocol ≥ 85%, deck ≥ 70%) |
| `pnpm e2e`       | Playwright, iPhone 14 / iPad / desktop viewports against two live hubs (build first)                                                               |
| `pnpm perf`      | loopback latency harness (p95 input→ack < 30 ms) + bundle gates (boot ≤ 300 KB gz, lazy 3D chunk ≤ 280 KB gz)                                      |

CI runs all of it on ubuntu + macos, Node 22 + 24. A red gate blocks merge;
please don't `.skip` your way around one.

House rules that lint enforces so reviews don't have to: TypeScript strict
and ESM everywhere; `any`, `@ts-ignore`, and `eslint-disable` comments are
errors; no `console.*` outside `packages/hub/src/logger.ts`; UI copy is
sentence case with no exclamation marks. Conventional commits (`feat:`,
`fix:`, `test:`, `docs:`, `chore:`), and `pnpm changeset` for anything
user-visible.

## Extending OpenDeck

The deck is deliberately data-driven so most extensions are small PRs:

- **A new theme**: add a `ThemeTokens` object in
  `packages/deck/src/state/themes.ts` and register it in `PRESET_THEMES`.
  Users can already build and share themes as JSON without any code.
- **A new key icon**: one line in `packages/deck/src/state/icons.ts` — the
  curated set is what keeps shared layout JSON portable.
- **New default bindings or layouts**: `packages/deck/src/state/layouts.ts`
  (`DEFAULT_ACTION_KEYS`, `DEFAULT_JOG_BINDINGS`, `LAYOUT_PRESETS`).
- **A new widget**: drop a component in `packages/deck/src/widgets/`, add a
  visibility flag to `WidgetVisibility`, render it from `GridScreen`, and
  give it a toggle in `EditOverlay`. Widgets read the zustand store and call
  `controller` — never the socket directly.
- **A new switch sound**: add a `Voice` to the `DOWN` table in
  `packages/deck/src/lib/sound.ts` (three layers: click leaf, plate strike,
  case resonance) and a chip in Settings. Users who just want their favorite
  switch can import a recording via the `custom` preset — no code at all.
- **The device faces**: both renderers share one brain,
  `packages/deck/src/state/micro-model.ts` — behavior changes go there so
  the WebGL face (`Micro3D.tsx`, three.js + react-three-fiber, lazy chunk)
  and the CSS face (`MicroDeck.tsx`) can never disagree. Visual polish goes
  in the face you're improving. The 3D face mirrors every control in a
  visually-hidden DOM layer; keep it in sync or the E2E suite will tell you.
- **A new screen-side capability** (protocol change): extend the zod schemas
  in `packages/protocol` first; both hub and deck validate at that boundary,
  and the codec round-trip tests will hold you honest.

## Writing an adapter

Adapters live in `packages/hub/src/adapters/<harness>/` and implement the
interface in `src/adapters/types.ts`:

```ts
interface Adapter {
  harness: Harness;
  detect(): Promise<DetectResult>; // verify real flags; never guess
  spawn(opts: SpawnOpts): Promise<ManagedSession>;
  attachObservers(): Promise<void>; // observed mode, if the harness has one
  dispose(): Promise<void>;
}
```

The pattern that keeps adapters testable, taken from the two that ship:

1. **Split the process from the protocol.** Put stream normalization in a
   pure class (`ClaudeStreamNormalizer`, `CodexStreamNormalizer`) that maps
   harness output onto a `SessionSink`. Make the process boundary injectable
   (`QueryFn`, `CodexRunner`) so tests replay fixtures with no binary.
2. **Record fixtures, sanitized, into `packages/hub/test/fixtures/`.** Real
   output from the installed CLI where possible; JSONL, one event per line.
3. **Register honestly.** `capabilities` is per-session truth — if your
   harness can't answer an approval mid-stream, don't advertise `approve`;
   the deck renders whatever you claim.
4. **Run the contract.** Add a driver in `packages/hub/test/` calling
   `runAdapterContract(...)` from `adapter-contract.ts`: happy path to
   `done`, error path, permission round-trip (or an honest declaration that
   there isn't one), resume with the harness-native id.
5. **Degrade in `detect()`.** Check the flags you depend on against the
   installed binary and return a human-readable `note` for the startup
   banner. A missing flag disables a capability; it never crashes the hub.

## Releasing

Changesets drive versioning. `pnpm changeset` in your PR; the release
workflow publishes `opendeck` to npm with provenance when the release PR
merges.
