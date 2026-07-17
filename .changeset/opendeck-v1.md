---
'opendeck': major
---

OpenDeck 1.0.0 — a physical-feeling command deck for AI coding agents.

- One-command hub: `npx opendeck`, QR pairing with one-time tokens, LAN-only, no cloud.
- Claude Code managed sessions (Agent SDK) with deck approvals, diff previews, and a model/thinking dial; observed terminal sessions via `opendeck connect claude` hooks, including deck-answered permission prompts.
- Codex managed sessions over `codex exec --json` with a reasoning-effort dial, thread resume, and sandbox presets.
- The deck: installable always-awake PWA with agent tiles, action keys, dial, jog pad, voice key, ticker and stat bar; Graphite/Workshop/Void themes with a live token editor; press physics, haptics, synthesized key ticks.
- Zero-loss reconnects via a 1,000-event replay buffer and `resume { lastSeq }`; p95 input→ack under 30 ms on loopback, enforced in CI.
