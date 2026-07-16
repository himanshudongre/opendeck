# AgentDeck — Product & Engineering Specification

**Version:** 1.0 · **Status:** Approved for build · **License:** MIT · **Repo name:** `agentdeck`

> A physical-feeling command deck for AI coding agents, made of software.
> Turn any phone, tablet, or spare screen into a zero-lag control surface for Claude Code and Codex — glanceable live status, tactile controls, one-tap approvals. No hardware to buy. `npx agentdeck`, scan a QR code, done.

---

## 1. Vision & positioning

OpenAI's Codex Micro ($230, limited run) sells two real things: **ambient glanceable status** (six RGB "Agent Keys" in your peripheral vision) and **one-press tactile control** (13 keys, a dial for reasoning effort, a joystick for workflows, a voice shortcut). It works only with Codex and only at your desk.

AgentDeck delivers both of those experiences — and everything the plastic can't — using a device the user already owns:

- **Unlimited agents**, not six. Every tile shows status color _plus_ harness, repo/branch, elapsed time, current tool, and token cost.
- **Real approvals.** When an agent asks for permission, the deck shows the actual command or diff and lets you approve, deny, or always-allow. An RGB key can only blink at you.
- **Harness-agnostic.** Claude Code and Codex at launch, behind one adapter interface. OpenCode next. A simulator adapter ships in v1 for demos and tests.
- **A peripheral, not another dashboard.** Fullscreen, chrome-less, always-awake, designed to sit on a stand next to the keyboard and be read from across the room. This is the positioning wedge: existing tools (amux, CliDeck, Omnara, Happy, Claude Code's own Agent View) are remote-control dashboards. AgentDeck is desk furniture.
- **$0, open source, no cloud, no telemetry.**

**Non-goals (v1):** agent orchestration/scheduling, git worktree management, kanban boards, running agents on remote machines (single local hub only), native mobile apps, Windows-first polish (must work on Windows; macOS/Linux are the reference platforms).

---

## 2. System overview

```
┌────────────────────────── Dev machine (macOS/Linux/Windows) ──────────────────────────┐
│                                                                                        │
│  Claude Code ──(Agent SDK / HTTP hooks)──┐                                             │
│  Codex CLI ───(exec --json / proto)──────┤    ┌───────────── HUB ──────────────┐       │
│  OpenCode ────(serve HTTP+SSE) [v1.1]────┼───▶│ adapters → session registry →  │       │
│  Simulator ──(in-process)────────────────┘    │ event bus → replay buffer →    │       │
│                                               │ WebSocket + REST + static deck │       │
│                                               └───────────────┬────────────────┘       │
└───────────────────────────────────────────────────────────────┼────────────────────────┘
                                                       LAN (WS, :3325/:3326)
                                                                │
                              ┌─────────────┬──────────────┬────┴─────────┐
                              │  old phone  │   iPad on    │  browser tab │
                              │  on a stand │   a stand    │  2nd monitor │
                              └─────────────┴──────────────┴──────────────┘
                                        THE DECK (PWA, installable)
```

Three artifacts, one monorepo:

| Package              | What it is                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`  | Zod schemas + TypeScript types for every message. The single source of truth.                                                    |
| `packages/hub`       | Node CLI + server. Owns adapters, sessions, auth, WebSocket fan-out, and serves the built deck. Published to npm as `agentdeck`. |
| `packages/deck`      | The PWA. React + Vite + Tailwind. No component library — custom design system (§7).                                              |
| `packages/simulator` | Deterministic fake agent driving demos, screenshots, and E2E tests.                                                              |

---

## 3. Protocol (`packages/protocol`)

All communication is JSON over a single WebSocket per client. Every schema lives in `protocol` and is validated with Zod on both ends. Protocol carries a `v` field; hub rejects mismatched majors with a friendly upgrade message.

### 3.1 Core entities

```
Session {
  id, hubId, harness: "claude" | "codex" | "opencode" | "simulator",
  mode: "managed" | "observed",        // managed = hub spawned it; observed = user's own terminal
  title, cwd, repo?, branch?, model?,
  status: SessionStatus, statusSince, lastActivity,
  currentTool?: { name, detail },       // e.g. { name: "Bash", detail: "pnpm test" }
  stats: { inputTokens, outputTokens, costUsd?, turns, elapsedMs },
  capabilities: Capability[]            // what the adapter can do for THIS session
}

SessionStatus = "idle" | "thinking" | "working" | "waiting_input"
              | "waiting_permission" | "done" | "error" | "disconnected"

Capability = "prompt" | "interrupt" | "approve" | "set_effort" | "set_model"
           | "resume" | "kill" | "transcript"
```

The deck renders strictly from `Session` + event stream; it has zero harness-specific logic. Adapters do all normalization.

### 3.2 Message envelope & delivery guarantees

```
ServerMsg = { v, seq, ts, type, payload }     // seq: monotonic per connection
ClientMsg = { v, id, type, payload }          // id: client uuid, echoed in acks
```

- **Server→client:** `hello`, `session_upsert`, `session_removed`, `event` (transcript/tool/status deltas), `permission_request`, `permission_resolved`, `ack`, `error`, `pong`.
- **Client→server:** `subscribe`, `action` (see §3.3), `permission_response`, `set_effort`, `prompt`, `voice_prompt`, `ping`, `resume { lastSeq }`.
- Hub keeps a **ring buffer of the last 1,000 events per session**. On reconnect the client sends `resume { lastSeq }` and the hub replays the gap — no missed status changes, ever. If the gap exceeds the buffer, hub sends a full snapshot.
- Heartbeat: client `ping` every 5 s; either side treats 12 s of silence as dead and the client enters reconnect (backoff 0.5 s → 8 s with jitter, forever). The deck must visibly distinguish `connected / reconnecting / hub offline` states.

### 3.3 Actions

Actions are declarative so the deck can bind any control to any action:

```
Action = { sessionId?, kind, args? }
kind = "approve" | "deny" | "always_allow" | "interrupt" | "prompt_template"
     | "resume" | "kill" | "new_session" | "shell" | "compact" | "custom"
```

`shell` actions run a user-configured command on the dev machine and **always require an explicit confirm tap** on the deck (§8 security).

### 3.4 Latency budget (the "absolutely no lag" contract)

| Path                            | Budget (p95, LAN)                                     |
| ------------------------------- | ----------------------------------------------------- |
| Deck input → hub ack round-trip | **< 30 ms**                                           |
| Adapter event → tile paint      | < 1 frame after WS receive (< 50 ms end-to-end)       |
| Dial drag → on-screen response  | 0 ms (optimistic local), value sync ≤ 16 ms coalesced |

Engineering rules that make this real: high-frequency inputs (dial, jog) are coalesced client-side to one message per animation frame carrying only the latest value; all optimistic UI with server reconciliation on `ack`; WS messages are small flat JSON (no transcript bodies on the deck grid — transcript streams only when a Focus view is open); animations use `transform`/`opacity`/`filter` only. A perf test in CI asserts the round-trip budget (§9).

---

## 4. Adapters (`packages/hub/src/adapters`)

One interface, per-session capability flags:

```ts
interface Adapter {
  harness: Harness;
  detect(): Promise<DetectResult>; // installed? version? path?
  spawn(opts: SpawnOpts): Promise<ManagedSession>; // managed mode
  attachObservers(): Promise<void>; // observed mode (if supported)
  dispose(): Promise<void>;
}
```

> **Build-time rule:** external CLIs move fast. Adapters must verify flags against the installed binary (`claude --help`, `codex exec --help`, version checks) during `detect()`, degrade capabilities gracefully, and never hard-fail the hub because one harness changed a flag.

### 4.1 Claude Code

**Managed sessions (full control)** — via `@anthropic-ai/claude-agent-sdk`:

- Spawn with streaming input; map SDK message stream → `event`s and `SessionStatus`.
- **Approvals:** the SDK's `canUseTool` callback becomes a `permission_request` to the deck (tool name, pretty-printed input, diff preview for file edits). The callback resolves when the user taps approve/deny/always-allow. Configurable timeout (default: none — wait).
- **Dial:** maps to model select (Haiku/Sonnet/Opus tiers) and thinking budget (`maxThinkingTokens` steps: off / 4k / 16k / 32k). Both are per-session settings surfaced as dial detents.
- Resume via session id.

**Observed sessions (the terminal the user already has open)** — via Claude Code **HTTP hooks**. `agentdeck connect claude` writes hook config (scoped to `~/.claude/settings.json` or a project's `.claude/settings.json`, user's choice, idempotent, with clean `disconnect` removal) that POSTs lifecycle events to the hub:

- `SessionStart` / `SessionEnd` → session upsert/remove
- `UserPromptSubmit` → status `thinking`
- `PreToolUse` / `PostToolUse` → status `working` + `currentTool`
- `Notification` (`permission_prompt`, `idle_prompt`) → `waiting_permission` / `waiting_input`
- `Stop` → `done`
- `PermissionRequest` → route the actual permission decision to the deck and answer via the hook response, so **even terminal sessions get deck approvals**. (Verify exact response schema against installed version; if unavailable, fall back to Notification-based "waiting" status + a "focus terminal" hint on the tile.)

### 4.2 Codex

**Managed sessions** — spawn `codex exec --json`, parse the JSONL event stream → normalized events. Reasoning dial maps to `-c model_reasoning_effort=` (`minimal/low/medium/high`) applied per new turn; approvals via Codex approval policy surfaced as `permission_request` where the stream supports it, otherwise run sandboxed with policy presets selectable from the deck. `codex resume` for continuity. If the installed version exposes the app-server/proto JSON-RPC interface, prefer it (richer control); `exec --json` is the guaranteed floor.

### 4.3 OpenCode (v1.1, interface reserved in v1)

`opencode serve` HTTP + SSE: create sessions, send prompts, stream events, list models for the dial.

### 4.4 Simulator (ships in v1, load-bearing)

Scripted scenarios (`demo.ts` fixtures): multi-agent fleets cycling through realistic statuses, permission requests with sample diffs, an error, a long-runner. Powers `agentdeck --demo` (instant gorgeous demo with zero setup — this is the README GIF), Playwright E2E, and screenshot generation. Deterministic via seeded timings.

---

## 5. Connection & pairing (the "it just works" flow)

```
$ npx agentdeck
  ▲ AgentDeck hub v1.0.0
  ● Claude Code 2.x detected · ● Codex 0.x detected
  Deck ready →  http://studio.local:3325      (or http://192.168.1.24:3325)
  [QR CODE]    scan with your phone
```

1. QR encodes `http://<host>:3325/#pair=<one-time-token>`. Opening it pairs instantly: token is exchanged for a long-lived device credential (stored in `localStorage`, revocable from hub CLI `agentdeck devices`). The terminal prints "📱 iPad paired".
2. `hostname.local` (mDNS) is printed alongside the raw IP; QR is the primary path so discovery never blocks anyone.
3. Subsequent visits auto-connect: the PWA remembers the hub, reconnects with backoff, resumes via `lastSeq`. Kill the hub, restart it — the deck comes back by itself.
4. Multiple simultaneous clients are first-class (phone + iPad + a desktop tab), all live, all consistent.
5. **HTTPS lane for mic & wake-lock:** browsers gate `getUserMedia`/Wake Lock behind secure contexts. Hub also serves HTTPS on `:3326` with a generated, persisted self-signed cert. Default QR uses HTTP (zero friction); Settings → "Enable voice" walks the one-time cert-trust step and flips the deck to `:3326`. On HTTP, the voice key hides with an explanatory tooltip and wake-lock falls back to the silent-video trick. This trade-off is documented in-app, not discovered by users.

---

## 6. The Deck — screens & widgets

**Screens:** Pair → **Grid** (home) → **Focus** (one session: transcript tail, live tool activity, diff/permission cards, prompt bar, per-session dial) → Edit mode (long-press) → Settings (themes, hubs, devices, sounds/haptics, voice) → Theme editor (token-level, live preview, export/import JSON).

**Widgets (all bindable, all configurable):**

| Widget         | Behavior                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent Tile** | The hero. Status glow + name + harness mark + branch + elapsed + current tool line + cost meter. Tap → Focus. Long-press → quick actions. Sizes S/M/L.                            |
| **Action Key** | Bind to any Action (§3.3): approve, interrupt, retry, commit, run tests, prompt snippet, custom shell (confirm-gated). Icon + label, per-key accent, press physics + haptic tick. |
| **Dial**       | Circular drag with detents. Binds per-harness: Claude model/thinking, Codex reasoning effort. Haptic tick per detent, brass needle, current value in mono type.                   |
| **Jog Pad**    | Four-direction flick pad mapped to prompt-template workflows ("fix failing tests", "review diff", user-defined with `{{variables}}`).                                             |
| **Voice Key**  | Hold-to-talk → Web Speech API → live transcript overlay → release to send to focused session. Language configurable.                                                              |
| **Ticker**     | One-line scrolling feed of fleet events.                                                                                                                                          |
| **Stat Bar**   | Fleet totals: running/waiting counts, today's tokens/cost, hub latency ms (live, honest).                                                                                         |

**Layouts:** v1 ships four presets (Phone Portrait, Phone Landscape, Tablet, Desktop Strip) plus edit mode for reordering tiles, toggling widgets, resizing tiles, and configuring bindings. Layouts and themes serialize to shareable JSON. Free-form grid editor is v1.1.

**Peripheral behaviors:** installable PWA (offline app shell), fullscreen kiosk mode, wake lock, orientation aware, notification permission optional (background tab pings when an agent starts waiting), left-hand mode, `prefers-reduced-motion` respected everywhere.

---

## 7. Design language — "Backlit Hardware"

The deck must read as a _device_, not a web page. One signature idea, executed with discipline: **every control is a backlit frosted keycap on a machined slab.**

### 7.1 Tokens (Graphite, default theme)

| Token                      | Value                                                        | Use                                                                                           |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `surface-0`                | `#0E0F12`                                                    | Deck slab background                                                                          |
| `surface-1`                | `#16181D`                                                    | Panels, focus view                                                                            |
| `key-face`                 | `#1E2127` + `rgba(255,255,255,.05)` top-edge inset highlight | Keycap body                                                                                   |
| `hairline`                 | `#2A2E36`                                                    | 1px machined seams                                                                            |
| `ink-1 / ink-2 / ink-3`    | `#E9EBEE / #9BA1AC / #5C626D`                                | Text hierarchy                                                                                |
| `brass`                    | `#D8B36A`                                                    | Dial needle, focus rings, brand marks — the machined-metal accent. **Never** used for status. |
| status `thinking`          | `#A78BFA` breathing (2.4 s)                                  | violet                                                                                        |
| status `working`           | `#4CC2FF` steady                                             | cyan                                                                                          |
| status `waiting_*`         | `#FFB454` pulse (1.2 s)                                      | amber — the "look at me" color                                                                |
| status `done`              | `#3ECF8E`                                                    | green                                                                                         |
| status `error`             | `#FF5D5D`                                                    | red                                                                                           |
| status `idle/disconnected` | `#3A3F48`                                                    | dim                                                                                           |

**Signature — Deskglow:** each tile's status color bleeds a soft radial glow onto the slab beneath it, and the page's ambient edges tint toward the _aggregate_ fleet state. From across the room, the whole screen is one big status light. If everything's amber, you know before you can read a word. (Subtle: ≤ 8% opacity fields, disabled under reduced-motion-and-transparency preferences.)

### 7.2 Type & texture

- **Display/labels:** Space Grotesk (600) — geometric, instrument-panel character.
- **Body/UI:** Inter.
- **Data (timers, tokens, latency):** IBM Plex Mono, tabular numerals.
- All fonts self-hosted via `@fontsource` (the PWA must render identically offline; no CDN calls ever).
- Texture: 1px top-edge specular on keys, 2% monochrome noise on `surface-0`, radii 10px keys / 18px panels. No gradients except status glows.

### 7.3 Motion & feel

- Key press: 120 ms spring (translateY 1px, scale .97, glow bloom), `navigator.vibrate(8)` where supported; WebAudio-synthesized tick (two synth presets: "clicky" and "silent" — the same choice the hardware sells, as a free toggle).
- Status change: 240 ms crossfade; `waiting` pulse must be visible at 3 m distance.
- Dial: pointer-tracked with inertia, detent snap + haptic; never rubber-bands.
- Alternate themes: **Workshop** (cream `#EDE6D6` slab, charcoal keys — the Work Louder retro homage) and **Void** (true `#000` AMOLED). Theme = token JSON; the editor edits tokens live.

### 7.4 Copy rules

Sentence case, plain verbs, no filler, no exclamation marks. Buttons say what they do ("Approve edit", not "Submit"). Errors state what happened and the next step. Empty grid says: "No agents yet. Start one in your terminal, or run `agentdeck --demo` to see the deck in motion."

---

## 8. Configuration & security

- `~/.agentdeck/` holds `config.json` (port, bind, theme defaults, custom actions, prompt templates), `devices.json` (paired device credentials), `cert/`, `logs/`. All hand-editable; hub validates with Zod and prints friendly errors.
- **Security model:** binds LAN by default but every WS/REST call requires a paired-device credential; pairing tokens are one-time and 10-minute expiring; `Origin` checked; pairing attempts rate-limited; `agentdeck devices revoke <id>`. `--localhost-only` and `--no-auth` (loud warning) flags exist. `shell` actions require per-action confirm on the deck and are defined only in `config.json`, never creatable from a client. No analytics, no update phone-home, no cloud path at all.

---

## 9. Quality bar & testing (what "not vibe-coded" means, mechanically)

- **TypeScript strict** everywhere; ESM only; `any` is a lint error; ESLint (typescript-eslint strict) + Prettier; no `console.*` outside the logger; no TODO/FIXME in committed code.
- **Unit (Vitest):** protocol codecs round-trip every message type; session registry; replay buffer (gap, overflow, resume); auth/pairing; adapter normalizers.
- **Adapter contract tests:** recorded JSONL fixtures (Claude stream-json, Codex exec --json, hook POST bodies) replayed against adapters — CI never needs API keys or installed CLIs. Each adapter must pass the same behavioral contract suite (status transitions, permission round-trip, resume).
- **E2E (Playwright, iPhone 14 + iPad + desktop viewports), simulator-driven:** pairing via tokened URL; tiles reflect scripted status changes; approve flow round-trips a permission; **reconnect test** (kill the socket mid-scenario, assert auto-resume with zero missed events); voice key gated correctly by context; theme switch; reduced-motion snapshot.
- **Perf test in CI:** scripted client asserts p95 input→ack < 30 ms over loopback and event→render under budget; bundle-size gate (deck ≤ 300 KB gz).
- **Coverage gates:** hub + protocol ≥ 85% lines/branches; deck ≥ 70%.
- **CI (GitHub Actions):** lint → typecheck → unit → build → E2E → perf, on ubuntu + macos, Node 20 + 22. Release via Changesets → npm publish with provenance.

## 10. Repository standard

```
agentdeck/
├─ packages/{protocol,hub,deck,simulator}/
├─ e2e/                      # Playwright suites + latency harness
├─ docs/                     # screenshots (Playwright-generated), GIF script, architecture.md
├─ .github/workflows/{ci,release}.yml + issue/PR templates
├─ CLAUDE.md  SPEC.md  DECISIONS.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  LICENSE  README.md
```

README anatomy (in order): logo + one-liner → demo GIF (from `--demo`) → 30-second quickstart (`npx agentdeck`) → feature grid vs Codex Micro comparison table → architecture diagram (Mermaid) → harness setup (Claude / Codex) → configuration → contributing → FAQ ("Is my code sent anywhere?" — No, and here's why you can verify that). Every claim in the README must be true on day one.

## 11. Roadmap

- **v1.0 (the one-shot target):** everything above except items marked v1.1.
- **v1.1:** OpenCode adapter, free-form grid editor, prompt-template library UI, per-project scenes, Whisper fallback for voice.
- **v2:** multi-hub (several dev machines on one deck), surfaces API — OpenRGB bridge (your existing keyboard's F-row becomes literal Agent Keys), Stream Deck plugin, menu-bar tray, smart-bulb webhook.

## 12. Definition of Done (v1.0 release gate)

- [ ] `npx agentdeck` → QR → paired phone → live tiles, on a clean machine, in under 60 seconds
- [ ] `agentdeck --demo` shows a full fleet with zero agents installed
- [ ] Claude Code: managed spawn with deck approvals; observed terminal session reflects status via hooks
- [ ] Codex: managed spawn with JSONL streaming and reasoning dial
- [ ] Reconnect after hub restart or network blip with zero lost status changes
- [ ] All CI jobs green; coverage gates met; perf budgets asserted; bundle gate met
- [ ] Lighthouse: installable PWA, a11y ≥ 95 on Grid and Focus
- [ ] README with real GIF + screenshots; CONTRIBUTING; MIT license; issue templates; v1.0.0 changeset
- [ ] Zero TODOs, zero `any`, zero skipped tests, zero placeholder copy anywhere
