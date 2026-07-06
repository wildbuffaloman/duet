# duet — Positioning note

*Written 2026-07-06 from the deep-planning research session (3 web-research agents: incumbent terminals · web/collab tech · voice+editor). This satisfies the M4 competitive-study gate. Re-check before the M4 distribution push.*

## The wedge (verified alive as of 2026-07-06)

No shipping product does **"any process renders a live HTML card by writing a self-contained file into a directory — zero SDK, any language"**, and none has **session-linked pane groups** (terminal + canvas panes sharing an id/color). duet's two differentiators hold.

## Incumbent read

### Wave Terminal — the closest, and the one to watch
- Open-source, Electron+Go, block-based workspace; actively developed (v0.14.5, Apr 2026).
- Its "web widget" is **URL-only, config-registered (`widgets.json`), `wsh`-bound** — no arbitrary HTML, weak inter-block comms. That registry model is precisely the anti-pattern duet's file protocol beats: **the directory IS the registry.**
- **Watch item: Tsunami widget framework** (WIP, unshipped as of Jul 2026). If it lowers the bar for emitting rich UI it *approaches* duet's space — but it's still framework/SDK-bound, not a file-drop protocol. Re-check Tsunami status at each milestone boundary.
- Worth stealing (already folded into the roadmap): `wsh badge` PID-linked status badges (M3a), durable sessions (M1), quake mode (M1.5).

### Warp — orthogonal
- Repositioned as an "agentic development environment": Oz cloud-agent orchestration (Feb 2026), multi-harness "single pane of glass" (May 2026), source-available dual MIT/AGPL (Apr 2026). Free / $18 / $180 tiers.
- Proprietary block-reformatting input editor (not a raw PTY), cloud-first agents. Competes on agent orchestration, not on a local rendering protocol.
- Worth stealing: share-link ergonomics (auto-tracked links + audit trail) for M5 — the UX, not the cloud backend.

### Ghostty — pure emulator, no canvas concept
- 1.3.0 (Mar 2026): renderer rearchitecture (damage tracking, 2–5× less terminal-lock time), scrollback search, native scrollbars, drag-to-reorder splits. These are now **table-stakes** — M1 closes that gap.
- libghostty-vt (zero-dep VT core; WASM target planned) + community `ghostty-web`/Restty (xterm.js-API-compatible, WebGPU) — a credible future renderer swap path for duet, low-friction because they mimic the xterm.js API. Watch, don't adopt yet.

## What duet deliberately will NOT build

1. **Cloud agent hosting / Oz-style orchestration** — breaks the 127.0.0.1 local-first wedge; massive scope sink.
2. **Embedded LLM/chat with vendor model backends** (Wave's OpenAI/Gemini panes) — duet is agent-agnostic; a favored chat pane competes with the agents it hosts.
3. **A config-registered widget registry** (`widgets.json` model) — the directory is the registry.
4. **Block-reformatting input editor** (Warp) — duet stays a real raw-PTY terminal; that's a feature.
5. **Notebooks / workflow knowledge base** (Warp Drive) — scope creep unrelated to the wedge.
6. **Multi-agent orchestration UI** — duet is the substrate agents run in, not an orchestrator.

## Technical positioning notes (from the same research)

- **xterm.js 6.0**: canvas addon removed — only WebGL + DOM renderers exist. duet's fallback claim is audited in M1; `webglcontextlost` handling matters for the Tauri webview (M1.5 benchmark gate: WKWebView WebGL stalls are documented).
- **State sync**: per-field LWW-register for `.state.json` (M3b) — no CRDT library; tldraw itself abandoned pure CRDTs for canvas state. Yjs reconsidered only if M5 brings concurrent structured editing.
- **Events/replay**: `.events.jsonl` uses asciicast-v3-style NDJSON with relative-time intervals (M3a), which makes M5's synchronized terminal+canvas replay nearly free (asciinema-player drives the clock).
- **Remote (M5)**: sshx is the architecture template — Rust relay, server-authoritative, E2E, read-only links.
- **Voice (M-V, last in queue)**: CC ships native `/voice` dictation (STT); the unowned gap is **TTS-back**. duet's angle: agent hooks → session events → local TTS — rides the file protocol, agent-agnostic, no ANSI parsing.

## Sources

Wave: docs.waveterm.dev (release notes, custom widgets) · Warp: warp.dev/blog (Oz, multi-harness) · Ghostty: ghostty.org 1.3.0 release notes, mitchellh.com (libghostty) · xterm.js: github.com/xtermjs releases · sshx: github.com/ekzhang/sshx · tldraw sync: tldraw.dev/docs/sync · asciinema: docs.asciinema.org (v3) · CC voice/hooks: code.claude.com/docs. Full per-finding source list + confidence grades: vault INBOX `Research - duet Roadmap Restructure - 2026-07-06`.
