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
- Fastify 5.10, ws 8.21, execa 9, commander 15, pino 10, tsup 8.5, Vitest 4.1, Vite 7.x, Tailwind 4.3, motion 12, vite-plugin-pwa 1.3, Playwright 1.61, ESLint 9 + typescript-eslint 8, Changesets 2.31 (see Phase 1 notes for the ESLint/Vite pins).

## Scaffold (Phase 1)

- ESLint pinned to 9.x (not 10.x): typescript-eslint 8's supported peer range; the whole quality gate rides on strict type-aware linting working flawlessly.
- Vite pinned to 7.x (not 8.x): vite-plugin-pwa 1.3 and the current Vitest/browser tooling are validated against Vite 7.
- `@agentdeck/protocol` and `@agentdeck/simulator` stay private and unbuilt (`main` → `src/index.ts`); tsup bundles them into the published `agentdeck` package via `noExternal`. One npm artifact, no internal version skew.
- Hub package version starts at 0.0.0 so the initial major changeset releases exactly 1.0.0.
- Lint gate = `eslint . && prettier --check .`; the banned-comment rule is `@eslint-community/eslint-comments/no-use` (bans all eslint directive comments, not just eslint-disable).
- Package `test` scripts are added only once a package has test files (empty Vitest suites exit non-zero; `passWithNoTests` would mask real misconfiguration).
- pnpm 11 wrote `allowBuilds`/`minimumReleaseAgeExclude` entries into pnpm-workspace.yaml (its supply-chain guard); esbuild's postinstall approved as required by Vite/tsup.

## Protocol design (Phase 2)

- Sequence numbers are hub-global and stable across reconnects (replayed messages keep their original `seq`); "monotonic per connection" (SPEC §3.2) holds because every connection sees a strictly increasing stream. Stability is what makes `resume { lastSeq }` meaningful.
- `hello` carries a `resume` discriminator (`fresh` / `resumed` / `snapshot`): the deck needs to know whether buffered messages follow or the hello itself is the catch-up.
- Client may pass `lastSeq` as a WS query param at connect (same code path as the `resume` message) so resume is atomic with the handshake — no race with live broadcasts.
- `set_effort` uses a generic `{ axis: model | thinking | effort, value }` shape; adapters validate values. Keeps the deck free of harness-specific logic (SPEC §3.1) while dial bindings stay per-harness configuration.
- Session events are a discriminated union: `status`, `transcript`, `tool`, `stats`, `notice` (notice powers the Ticker). Transcript deltas fan out only to clients subscribed to that session (SPEC §3.4).
- Permission resolutions from the deck are `approve/deny/always_allow`; `permission_resolved` adds `dismissed` (request became moot) and a `source` (deck vs harness) so every client can retire the card no matter who answered.

## Hub core (Phase 3)

- Replay buffer: one 1,000-entry ring per session (SPEC wording), `session_upsert`/`removed`/permission messages recorded in their session's ring; a resume gap in any ring falls back to a snapshot hello.
- WS auth via `?device=&credential=` query params (browsers can't set WS headers); REST snapshot auth via `x-agentdeck-*` headers. Credentials stored sha256-hashed in devices.json, compared timing-safe.
- Origin policy: same-hostname (any hub port) or explicitly allowed dev origins; absent Origin (non-browser clients) passes. Enforced at upgrade time with a 403.
- Shell runner is injected into the hub core (`runShell`), keeping core process-free and unit tests hermetic; execa lives at the composition boundary.
- Fastify runs with `logger: false`: fastify's type generics can't carry our pino instance under `exactOptionalPropertyTypes`, and hub logging already goes through `logger.ts`.
- `selfsigned` v5 is promise-based and takes `notAfterDate` (10-year cert), not `days`.
- Invalid config.json degrades to defaults with printed problems — the hub never refuses to start over recoverable config.

## Real adapters (Phase 5)

- **Claude managed** rides `@anthropic-ai/claude-agent-sdk` `query()` in streaming-input mode with `settingSources: []` (managed sessions must not load the user's hooks, or observed mode would double-report them). Dial: `setModel` (haiku/sonnet/opus aliases) and `setMaxThinkingTokens` (off/4k/16k/32k → 0/4096/16384/32768).
- The claude-stream fixture is **real recorded output** from the installed `claude 2.1.101` (`-p --output-format stream-json --verbose`, haiku, sanitized paths, rate_limit_event line dropped). The error-result fixture is synthetic but typed against the SDK's `SDKResultError`.
- **Claude observed** uses command hooks that POST the hook's stdin JSON to `http://127.0.0.1:<port>/api/hooks/claude` via curl (`--max-time 3` fire-and-forget for lifecycle events; `--max-time 310` for `PermissionRequest`, hook `timeout: 320`). The 2.1.x hook schema supports answering PermissionRequest via `hookSpecificOutput.decision` (verified against the SDK's mirrored types), so terminal sessions get deck approvals. Fast-fallback rules: no deck clients connected → immediate 204 (normal terminal prompt); deck silent for 5 minutes → dismiss and 204.
- The hooks route only accepts loopback sources; `connect`/`disconnect` are idempotent, marker = the `/api/hooks/claude` URL substring, and they never touch non-AgentDeck hooks.
- **Codex** floor is `codex exec --json` (JSONL), `exec resume <thread_id>` per follow-up turn, `-c model_reasoning_effort=` for the dial, `--sandbox` presets via a confirm-style custom action. Codex isn't installed here, so the JSONL fixtures follow the documented event shapes (`thread.started`, `turn.*`, `item.*` with `command_execution`/`file_change`/`agent_message`/`reasoning`/`mcp_tool_call`/`web_search`) and `detect()` re-verifies `--json` support on machines that have Codex; the app-server JSON-RPC mode was left out because there is no installed binary to verify it against (SPEC §4.2 keeps exec as the guaranteed floor).
- Codex exec cannot answer interactive approvals mid-stream, so codex sessions honestly omit the `approve` capability; the shared contract suite asserts that instead of skipping.
- Contract suite: process boundaries are injectable (`QueryFn` for the SDK, `CodexRunner` for execa, gateway takes raw hook payloads), so fixtures replay against real Hub instances and assert broadcast-level behavior.
- Hub `dispatch` converts controller validation throws (unknown dial detents, bad presets) into `bad_message` protocol errors instead of `internal`.

## Deck design plan (Phase 6, written before any deck code)

### Tokens (SPEC §7.1, Graphite defaults — implemented as CSS variables, Tailwind reads them)

| Variable        | Value                                                     | Use                                                  |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `--surface-0`   | `#0E0F12`                                                 | deck slab background                                 |
| `--surface-1`   | `#16181D`                                                 | panels, focus view                                   |
| `--key-face`    | `#1E2127` (+ inset top highlight `rgba(255,255,255,.05)`) | keycap body                                          |
| `--hairline`    | `#2A2E36`                                                 | 1px machined seams                                   |
| `--ink-1/2/3`   | `#E9EBEE / #9BA1AC / #5C626D`                             | text hierarchy                                       |
| `--brass`       | `#D8B36A`                                                 | dial needle, focus rings, brand marks — never status |
| `--st-thinking` | `#A78BFA` breathing 2.4 s                                 | violet                                               |
| `--st-working`  | `#4CC2FF` steady                                          | cyan                                                 |
| `--st-waiting`  | `#FFB454` pulse 1.2 s                                     | amber — readable from 3 m                            |
| `--st-done`     | `#3ECF8E`                                                 | green                                                |
| `--st-error`    | `#FF5D5D`                                                 | red                                                  |
| `--st-idle`     | `#3A3F48`                                                 | dim (also disconnected)                              |

Type: Space Grotesk 600 (display/labels), Inter (body), IBM Plex Mono tabular (timers/tokens/latency). All via `@fontsource`, zero CDN. Texture: 1px top-edge specular on keys, 2% monochrome SVG noise on `--surface-0`, radii 10px keys / 18px panels, gradients only for status glows.

### Deskglow (the signature)

Two layers. (1) Per-tile: a radial gradient in the tile's status color bleeding _beneath_ the keycap onto the slab, ≤8% opacity. (2) Ambient edges: fixed viewport-edge gradients tinted toward the aggregate fleet state (priority: error > waiting > working > thinking > idle), so from across the room the whole screen is one status light. Both layers use only `opacity`/`transform`/`filter`, and both are removed entirely under `prefers-reduced-motion` or `prefers-reduced-transparency`.

Not-a-template check: no cards-on-white, no sidebar-nav, no component library. Every control is a frosted keycap on one continuous slab; brass appears only on the dial needle, focus rings, and the wordmark; data is mono, labels are Grotesk. The amber waiting pulse is the loudest thing on screen by design.

### Wireframes

Grid (home — phone portrait):

```
┌────────────────────────────────┐
│ ▲ agentdeck   3 running · 1 ⏳ │  ← StatBar: fleet counts, tokens/cost today,
│ 41.2k tok · $0.31 · 12 ms ●    │     live hub latency, connection dot
├────────────────────────────────┤
│ ╭──────────╮  ╭──────────╮     │
│ │◤amber    │  │◤cyan     │     │  ← AgentTile: status glow bleeding under
│ │fix flaky │  │app router│     │     the keycap, title, harness mark,
│ │auth test │  │migration │     │     branch, elapsed mono timer,
│ │⌥ claude  │  │⌥ codex   │     │     current-tool line, cost meter
│ │fix/auth… │  │feat/app… │     │
│ │Edit src/…│  │Bash pnpm…│     │
│ │12:41 $.06│  │31:07 84k │     │
│ ╰──────────╯  ╰──────────╯     │
│  … more tiles …                │
├────────────────────────────────┤
│ ‹ticker: sim-auth waiting …›   │  ← one-line scrolling fleet feed
├────────────────────────────────┤
│ [✓ Approve] [◼ Stop] [⟳ Tests] │  ← ActionKeys (bindable)
│ [ JogPad ]  ( DIAL )  [🎤]     │  ← flick pad · brass-needle dial · voice
└────────────────────────────────┘
```

Focus (one session):

```
┌────────────────────────────────┐
│ ‹ back   fix flaky auth test   │
│ ● waiting_permission · claude  │
│ acme/api · fix/auth-retry      │
├────────────────────────────────┤
│ transcript tail (mono-dated)   │
│ ▸ tool line: Bash pnpm test ✓  │
│ ╭─ Edit src/auth/session.ts ─╮ │
│ │ --- a/src/auth/session.ts  │ │  ← PermissionCard: pretty input +
│ │ -  const retries = 1;      │ │     unified diff, red/green mono
│ │ +  for (let attempt = …    │ │
│ │ [Deny] [Approve] [Always]  │ │  ← buttons say what they do
│ ╰────────────────────────────╯ │
├────────────────────────────────┤
│ (DIAL: model/thinking) [◼][⏎] │
│ [ prompt bar…            ][🎤] │
└────────────────────────────────┘
```

Pair: single centered keycap panel — wordmark, one-line explanation, camera-less pairing state driven by the URL token (`#pair=…`), progress line, error state with next step. Settings: keycap list groups (Theme, Sound clicky/silent/off, Haptics, Left-hand mode, Voice + enable-voice HTTPS walkthrough, Devices, Layout export/import). Theme editor: token swatch rows with native color inputs, live preview tile, export/import JSON, reset per preset. Edit mode (long-press grid): preset picker (Phone Portrait / Phone Landscape / Tablet / Desktop Strip), widget visibility toggles, tile size S/M/L, action-key binding editor.

### Deck engineering decisions

- zustand store is the single client state: sessions map, ticker ring (50), focused transcript, pending permissions, connection state (`connected/reconnecting/offline` — always visible as the StatBar dot + a reconnect banner), settings, layout; server messages fold in through one `applyServerMsg` reducer shared by live socket and replay.
- Reconnect: exponential backoff 0.5 s → 8 s with full jitter, forever; `lastSeq` rides the WS query string so resume is atomic; heartbeat ping every 5 s, dead after 12 s of silence (SPEC §3.2). Latency for the StatBar = pong round-trip EMA.
- Dial/jog inputs coalesce client-side to one message per animation frame carrying the latest value (SPEC §3.4); optimistic UI reconciles from `ack.data`.
- Wake lock: `navigator.wakeLock` with a looping 2×2 muted webm fallback on HTTP (SPEC §6); voice key uses Web Speech only in secure contexts, otherwise shows the explanatory tooltip pointing at Settings → Enable voice.
- Sounds are WebAudio-synthesized (no audio assets): `clicky` = 1.8 kHz square blip + noise tap through a lowpass, `silent` = haptics only.
- PWA: vite-plugin-pwa `generateSW`, offline app shell, PNG icons generated at build by a dependency-free script (hand-rolled PNG encoder) so the repo carries no binary blobs.
- Themes ship as token JSON (Graphite, Workshop `#EDE6D6` cream slab with charcoal keys, Void true `#000`); `applyTheme` writes CSS variables; the editor edits the same JSON live and exports/imports it.

## Deck build notes (Phase 6, post-implementation)

- Custom CSS classes (`keycap`, `panel`, `font-*`) live in `@layer components` so Tailwind utilities keep winning the cascade (the dial's `rounded-full` was silently losing before this).
- A hub run with `--no-auth` is detected by probing `/api/snapshot` without credentials; the deck connects credential-less instead of demanding a pairing that can't exist.
- After a `fresh`/`snapshot` hello the hub re-sends pending permission requests to that client, so a rejoining deck regains its approval cards (replayed `resumed` gaps already carry them).
- `window.__AGENTDECK_STORE__` exposes the zustand store as a deliberate debugging/E2E surface.
- The store records `lastResume` from each hello — it is the observable proof that a reconnect was a replay (`resumed`) rather than a snapshot fallback.
- jsdom quirks under Node 25: the experimental Node `localStorage` shadows jsdom's (tests install a real in-memory Storage), and `Element.scrollTo`/`matchMedia`/rAF get deterministic stand-ins.

## E2E + perf (Phase 7)

- Playwright device projects (iPhone 14 / iPad / desktop) all run on chromium: one browser download in CI, same viewports/touch semantics; engine-specific behavior is not what these suites assert.
- Global setup boots two built hubs: an open one (`--no-auth`, sim speed 12) shared by the viewport suites, and an authenticated one whose banner-printed QR token feeds the pairing test. Tests that consume one-shot demo state (pairing token, permission approvals, network offline) are pinned to a single project; `workers: 1` keeps the shared fleet deterministic.
- The reconnect test asserts three things: the deck saw the offline gap (`lastSeq` catches up past a seq captured from `/api/snapshot` while offline), the hello was `resumed` (zero missed events, not a snapshot fallback), and the session set matches the hub's.
- Reduced-motion coverage asserts computed styles (Deskglow removed, pulses off) and archives a screenshot as a test artifact; golden-pixel comparisons across CI platforms are flake, not rigor.
- Voice-key gating: 127.0.0.1 is a secure context and chromium ships webkitSpeechRecognition, so E2E asserts the armed state; the insecure/unsupported branches are unit-tested where the context is controllable.
- Perf harness measures input→ack over a real WS with sequential `subscribe` messages (200 samples): p95 0.22 ms on loopback vs the 30 ms budget. Bundle gate gzips deck js+css: 120.8 KB vs the 300 KB budget.

## Phase log

- [x] Phase 0 — Recon
- [x] Phase 1 — Scaffold
- [x] Phase 2 — Protocol
- [x] Phase 3 — Hub core
- [x] Phase 4 — Simulator
- [x] Phase 5 — Real adapters
- [x] Phase 6 — Deck
- [x] Phase 7 — E2E + perf
- [ ] Phase 8 — Docs & release
- [ ] Phase 9 — Adversarial self-review
