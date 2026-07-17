# opendeck

## 1.0.0

### Major Changes

- 93c44ad: OpenDeck 1.0.0 — a physical-feeling command deck for AI coding agents.

  - One-command hub: `npx opendeck`, QR pairing with one-time tokens, LAN-only, no cloud.
  - Claude Code managed sessions (Agent SDK) with deck approvals, diff previews, and a model/thinking dial; observed terminal sessions via `opendeck connect claude` hooks, including deck-answered permission prompts.
  - Codex managed sessions over `codex exec --json` with a reasoning-effort dial, thread resume, and sandbox presets.
  - The deck: installable always-awake PWA with agent tiles, action keys, dial, jog pad, voice key, ticker and stat bar; Graphite/Workshop/Void themes with a live token editor; press physics, haptics, synthesized key ticks.
  - Zero-loss reconnects via a 1,000-event replay buffer and `resume { lastSeq }`; p95 input→ack under 30 ms on loopback, enforced in CI.

### Minor Changes

- d106096: The 3D device now takes its materials from the active theme: the Workshop theme renders the cream hardware build — warm plastic caps, silver knurled knob, dark glass display, tabletop product lighting — while dark themes keep the anodized graphite build. Both gain the signature per-key RGB underglow: status light bleeds from beneath each cap onto the plate, pulses while an agent waits, and squeezes brighter under a press.
- 970a6cb: Micro mode's default face is now a crisp, flat, straight-on product render — frosted keys with each agent's LED glowing through the cap, circular outline command buttons, a dashed-outline joystick, a clean notched dial, and a mic pill — in two builds: porcelain under light themes, graphite under dark ones. Swipe the plate to page through agents. The WebGL 3D face remains available under Settings → Device rendering.
- 62507be: Hyper-real switch feel: synthesized mechanical switch acoustics (layered click, plate strike, and case resonance with per-press detune, distinct press and release sounds, rotary detent ticks), a new `thocky` sound preset alongside `clicky`/`silent`/`off` with in-Settings audition, and asymmetric keycap press physics — fast bottom-out, sprung release, collapsing skirt.
- 4057476: The micro is now a real-time WebGL device by default: physically-based keycaps over glowing LEDs with true bloom, a knurled reasoning knob, a spring-loaded joystick that quivers on release, studio lighting, and an e-ink readout — rendered with three.js + react-three-fiber on React 19, shipped as a lazy chunk with automatic fallback to the CSS face. Plus bring-your-own-switch acoustics: import a recording of your favorite key switch (press + optional release) as the `custom` sound preset, stored locally.

### Patch Changes

- f0f1b6a: Touch-first usability pass on the 3D micro: near top-down framing that fills phone and tablet screens edge-to-edge (rows spread adaptively per viewport), whole-socket touch targets, vertical-drag knob with detent ticks, swipe the plate to page through agents, a larger readable LCD that leads with the pending question, raised-and-ringed selection, and lower GPU cost on mobile (capped pixel ratio, no MSAA).
- 0f9035c: A visible settings gear on the device plate (both faces), the flat device now scales to fill phones and iPads edge-to-edge, and tablets gain a third agent row — ten keys per page.
