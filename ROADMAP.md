# duet — Roadmap

**Vision.** Text drives, canvas shows. The terminal stays what it has always been — greppable, pipeable, plain text — while everything rich (charts, tables, previews, dashboards) lives in linked panes fed by the world's simplest render protocol: *write an `.html` file into a directory*. A session is the linkage; an agent or script that can write a file can render; and nothing on the data path is allowed to cost latency. duet should feel like Ghostty with a second sense.

---

## Build order (resequenced 2026-07-06 — deep-planning session)

Milestone numbers are **identity**, not order. The build order below is the roadmap; targets are soft. Two parallel tracks share no files: the **app track** (this repo) and the **skills track** (vault/plugin).

| # | Milestone | Target | Why here |
| --- | --- | --- | --- |
| 1 | M1 — Daily-driver polish | Jul 31 | Unblocks the replacement test; incumbents (Ghostty 1.3) just made this table-stakes |
| 2 | M1.5 — Tauri shell | Aug 15 | Kills the friction-log root cause (fragile browser-tab surface); pulled forward 2026-07-04 |
| 3 | M2 — Deep agent integration (CC-first reorder) | Aug 31 | `duet-canvas` skill = highest daily leverage + plugin seed |
| 4 | M3a — Events | Sep 30 | The copy-paste killer; also births the **agent-hooks bridge** that editor + badges (and voice, later) consume |
| 5 | M2.5 — Editor pane spike | Oct 15 | Moved after M3a: follow-mode feeds off PostToolUse events from the bridge — real infra, not speculation |
| 6 | M3b — Shared state | Oct 31 | LWW-register decision (no CRDT) de-risks it; builds on M3a plumbing |
| 7 | M3c — Gated stdin | with M4, if ever | Unchanged: last or never |
| 8 | M4 — Distribution | Dec 15 | Competitive-study gate **satisfied 2026-07-06** → `docs/POSITIONING.md` |
| 9 | M5 — Multiplayer / remote | 2027 Q1 | sshx-template architecture; replay is nearly free thanks to M3a's event format |
| 10 | M-V — Voice loop | 2027 Q2 (soft) | **Last in queue by operator decision 2026-07-06**; consumes M3a events |

**Replacement test** (4 consecutive weeks as default terminal, friction log at zero blockers): target **Aug 31**, runs on M1 + M1.5.

**Skills track (parallel, zero file overlap with app track):** S1 GitHub publication (done with this commit's push) → S2 `/html-template` v0.2.0 enrichment (own session, week of Jul 7) → S3 `duet-canvas` skill + `duet-pack` plugin scaffold (with M2) → S4 plugin published to the Bufalinda marketplace (gated on M4's 10-minute install test).

---

## M0 — MVP ✅ (shipped 2026-07-04)

What exists today (see `README.md`, `docs/PROTOCOL.md` v1, `server.js`, `public/app.js`):

- [x] BSP tiling in the browser: split right/down, flip a split (row↔col), drag-to-resize seams, close, swap, hide-to-tray/restore, layout persisted in localStorage
- [x] Every pane is a real terminal (PTY via `@lydell/node-pty`) **or** a render surface; toggle a pane's type in place
- [x] Sessions link panes; per-session color; reassign a pane's session
- [x] Canvas-directory protocol: `~/.duet/canvas/<sessionId>/`, write/overwrite/delete `*.html` ⇒ card mount/update/remove; `<title>` ⇒ card title; mtime ordering; 2 MiB card guard
- [x] `DUET_SESSION` / `DUET_CANVAS` injected into every PTY env
- [x] Transport per the v1 wire contract: binary WS frames for PTY bytes, `perMessageDeflate: false`, `TCP_NODELAY`, no logging on the data path; PTY backpressure (pause/resume at 1 MiB buffered)
- [x] WebGL xterm renderer with silent canvas fallback — *note (2026-07-06): xterm.js 6.0 removed the canvas addon; the actual fallback is the DOM renderer. Audit in M1.*
- [x] Security: `127.0.0.1` bind only, sessionId regex, basename-only card reads (`depth: 0`), Origin check on WS upgrade
- [x] `bin/duet` launcher (health-poll then open browser), `bin/duet-app` (dedicated app-mode window), `examples/demo.sh`, `examples/claude-instructions.md`, light/dark theme
- [x] Card→card links (M2 slice, shipped early — PROTOCOL.md §5.1)
- [x] HTML template library (M2 slice): `templates/` incubator + canonical vault home + `/html-template` router skill

---

## M1 — Daily-driver polish · **build slot 1 · target Jul 31**

Goal: replace your terminal app for a full workday without reaching for the mouse.

- [ ] Keyboard splits & navigation: `cmd+d` split right, `cmd+shift+d` split down, `cmd+alt+←/→/↑/↓` focus pane by direction, `cmd+w` close, `cmd+shift+enter` — all routed so they never collide with shell keybindings
- [ ] New splits inherit cwd + session (id/color) from the focused pane *(steal: Ghostty/Wave — added 2026-07-06)*
- [ ] Pane zoom: temporarily maximize the focused pane (`cmd+shift+z` toggle), layout preserved underneath
- [ ] Layout presets: save/restore named layouts (tree + pane types + session bindings), quick-switch from the toolbar
- [ ] Session rename: editable name (id stays immutable — it's the directory), name shown in legend + pane headers
- [ ] Terminal search: `cmd+f` in-pane find via `@xterm/addon-search`, with match count and highlight
- [ ] **Renderer-fallback audit** *(added 2026-07-06)*: xterm 6 has only two renderers (WebGL, DOM) — verify `public/app.js` falls back to the DOM renderer (the canvas addon no longer exists) and handle `webglcontextlost` (WKWebView drops contexts on suspend/OOM; matters again at M1.5)
- [ ] Reconnect resilience: server restart or WS drop → client auto-reconnects with backoff, re-fits terminals, re-snapshots canvases; a dead PTY pane offers one-key respawn instead of going blank; use `@xterm/addon-serialize` to snapshot/restore scrollback across reconnects *(addon note: serialize does not capture inline images)*
- [ ] Config file `~/.duet/config` (JSON or TOML): port, default shell/args, font family/size, theme, scrollback, keybinding overrides, default session count
- [ ] Scrollback + copy-mode basics: configurable scrollback, `cmd+k` clear
- [ ] LaunchAgent auto-start for the server (reboot/stale-tab resilience; interim until M1.5)

Deliberately NOT in M1 (→ M1.5 candy, don't inflate): quake-mode global hotkey, drag-to-reorder splits.

Ship test: a full day of real work in duet with zero mouse usage for pane management.

---

## M1.5 — Tauri shell · **build slot 2 · target Aug 15**

Goal: duet opens from the dock as a real app; the fragile browser-tab surface (friction log #1/#2) is gone. Pulled forward from M4 by decision 2026-07-04.

- [x] **Benchmark gate first** *(added 2026-07-06)*: measure input-to-glyph latency of the WebGL xterm renderer inside WKWebView **before** committing — WKWebView WebGL stalls are documented; keep the DOM-renderer fallback hot. If the <5ms budget breaks and can't be recovered, reconsider (Electron measurement, or stay browser+LaunchAgent until it resolves)
  - **PASSED 2026-07-10** (`public/bench/latency.html` + `bench/wkwebview_bench.swift`, arm64 MacBook): WebGL addon active in WKWebView, zero context losses; write→parsed p95 1ms (budget 5ms); write→frame p50/p95 30/31ms vs Chromium 29.8/30.7ms (parity — both vsync-quantized by the double-rAF measure); 2 MB burst 18 vs 20.5 MB/s, 1 stalled frame each. Caveat: bench window must be visible — WebKit suspends rAF when occluded.
- [ ] Tauri 2.x shell wrapping the existing client; node server as a **sidecar v1** (`tauri_plugin_shell`) — no Rust PTY rewrite yet (the `portable-pty` port is an M4 decision, taken with sidecar data; refs: `Tnze/tauri-plugin-pty`, `crynta/terax-ai`)
- [ ] Single-instance guard + "attach to running server" behavior (today's `bin/duet` health-poll logic, promoted)
- [ ] Dock icon, minimal native menus; badge on canvas activity
- [ ] Optional polish (if cheap): quake-mode global hotkey; drag-to-reorder splits

Multi-window, auto-update, and brew cask stay in M4.

Ship test: `duet.app` in the dock, cold-start to interactive terminal < 1s, replacement test runs on the app — zero stale-tab incidents.

---

## M2 — Deep agent integration · **build slot 3 · target Aug 31**

Goal: agents treat the canvas as a first-class output device, and cards are addressable from the text stream. **Internal order reversed 2026-07-06 — CC-first** (the skill is the highest-leverage item and the plugin seed; OSC handles moved last).

- [x] **Card→card links** (shipped early 2026-07-04): `<a href="duet:<id>">` / `[data-duet-card]` navigation via sandbox-safe postMessage (PROTOCOL.md §5.1)
- [ ] **1. Claude Code skill `duet-canvas` + plugin scaffold**: turn `examples/claude-instructions.md` into a proper skill (trigger: `$DUET_CANVAS` present) — render conventions (self-contained, sandbox-safe, §5.1 ids), template-library-first routing (canonical vault path → plugin-bundled `templates/` fallback). Scaffold the `duet-pack` plugin in-repo (skills + `/duet-setup` command; the app itself is NOT bundled — the repo is the distribution until M4's brew cask). Marketplace publication is gated at M4
- [ ] **2. `duet` CLI** (extend `bin/duet` with subcommands, all pure-filesystem so they work over the existing protocol):
  - [ ] `duet render <file> [--as <id>]` — copy/normalize a file into `$DUET_CANVAS` (md → self-contained html later)
  - [ ] `duet title <id> <title>` — rewrite a card's `<title>` in place
  - [ ] `duet clear [<id>]` — remove one card or the whole session canvas
  - [ ] `duet handle <id>` — emit the handle escape + text fallback
- [ ] **3. Handles in the text stream** (last within M2): an OSC 1337-style escape sequence (e.g. `OSC 1337;Duet=handle;card=<id> ST`) a CLI can emit; the client parses it out of the PTY stream and renders an inline "chip" that focuses/flashes the referenced card on click. Printed fallback stays greppable: `duet handle <card>`. (OSC-based control is industry-proven — OSC 52, Kitty graphics)
- [ ] Per-card **pin** (keep at top regardless of mtime order) and **collapse** (title-bar only), persisted client-side
- [ ] Card metadata sidecar convention (`<id>.json`, optional): pin/order hints written by tools — protocol stays "just files"

Ship test: `claude` in a fresh duet pane renders a chart to the canvas and prints a clickable handle, with zero setup.

---

## M2.5 — Editor pane spike (third pane type) · **build slot 5 · target Oct 15** — *investigation*

Goal: decide whether panes grow a third type — `editor` — without duet becoming a worse IDE. **Moved after M3a (2026-07-06):** the differentiating follow-mode feeds off the agent-hooks bridge born in M3a — the spike builds on real infra, not speculation.

- [ ] **Spike: CodeMirror 6 editor pane** — third case in the pane-body switch + split-popover option; file open/save via new scoped server endpoints; syntax highlighting, dirty indicator. *(Research 2026-07-06: CM6 over Monaco is decisive — 50–150 KB vs 2–5 MB, init <100ms, MIT.)* Timebox it: if it doesn't feel duet-native in a week, kill it
- [ ] **Session-linked follow mode ("watch the agent edit")** — the duet-native twist that justifies the pane type: an editor pane bound to a session auto-opens the file the agent most recently touched. **Detection: PostToolUse events from the M3a agent-hooks bridge** (`Edit|Write` → `tool_input.file_path`) as primary, fs-watch/git-status as fallback for script-driven edits. **Render: reload-and-diff on hook fire** via `@codemirror/merge` `unifiedMergeView` (inline before→after, `collapseUnchanged`) — not per-token streaming decorations (CPU lesson from Cline). UX model: Cline Background Edits (never steal the cursor)
- [ ] **Path-scoping decision before any file endpoint ships** — an editor pane widens the server from canvas-dir writes to arbitrary file read/write on localhost; define allowlisted roots per session (Origin check alone is not enough). Blocks the spike from merging
- [ ] **Cheap alternative to beat**: "open in editor" handles (card/terminal chip that opens the file in Zed/VS Code) — if this captures most of the value, the editor pane loses the decision
- [ ] **Explicit non-goals**: LSP, git UI, debugger, project-wide search — that's Zed/Cursor's company, not a pane type

Decision test: after a week of the spike, "watch the agent edit" is something you actually leave open — otherwise ship the open-in-editor handle and close the milestone.

---

## M3 — Tight loop: messaging & state sharing between cards and the session

Goal: **eliminate manual relay between screens.** Today the human is the message bus — copying a card's compiled prompt into the terminal, retyping terminal state into a card, re-rendering a whole file to change one number. M3 makes cards and the programs that rendered them share events and state natively. Built the duet way: **the session dir is the API (`.events.jsonl`, `.state.json`), the WebSocket is only the accelerator (<100ms), and the transport stays file-portable, language-agnostic, greppable.**

### M3a — Events · **build slot 4 · target Sep 30** — *the copy-paste killer*

Highest daily-friction payoff, and the primitive already half-exists: the shipped card→card link handler already ships clicks from a sandboxed card to the client via `postMessage` with unforgeable `contentWindow` matching.

- [ ] Generalize the shipped card→card link channel (PROTOCOL.md §5.1): a card posts `{__duet:"event", payload}` → client relays over the already-open canvas WS → server appends one JSON line to `~/.duet/canvas/<session>/.events.jsonl` (advertised as `$DUET_EVENTS`). Same `contentWindow` guard keeps the source card unforgeable
- [ ] **Event format = asciicast-v3-style NDJSON** *(added 2026-07-06)*: header line + one typed event per line with **relative-time intervals** — M5's synchronized replay becomes nearly free
- [ ] **Agent-hooks bridge** *(added 2026-07-06 — the second producer)*: Claude Code hooks (PostToolUse `Edit|Write`, Stop, Notification) append typed events to the session's `.events.jsonl` — configured by the `duet-canvas` skill, pure file-append (no HTTP required; the session dir is the API). Feeds M2.5 follow-mode, status badges, and (much later) M-V voice. Agent-agnostic by design: anything that can append a JSON line is a producer
- [ ] **Pane/session status badges** *(steal: Wave `wsh badge`)*: an event type sets a colored badge on the session's panes; PID-linked badges auto-clear when the process exits
- [ ] Card bridge: `data-duet-event` buttons and form submits emit `{card, type, data}`; **the template library's "Copy feedback" button becomes "Send to session"** inside duet (clipboard demoted to the standalone-only fallback — supersedes template rule #5)
- [ ] Consume with zero HTTP in a script: `duet await` (blocks, prints next event on stdout for `$(…)` capture) and `duet events` (tails as line-JSON for `while read -r ev; do …`)
- [ ] No-reader/backpressure semantics: non-blocking append, bounded buffer, dropped-with-counter when nothing is tailing

### M3b — Shared session state (both directions) · **build slot 6 · target Oct 31**

- [ ] One `~/.duet/canvas/<session>/.state.json` per session (advertised as `$DUET_STATE`). Server watches it; on change pushes `{__duet:"state", data}` to every card in the session over the open WS — cards patch their DOM live, no file rewrite
- [ ] **Merge semantics decided (2026-07-06): per-field LWW-register** — each key carries `{value, seq}` (monotonic seq/timestamp); a card `setState` patch and an agent `fs` write merge field-wise, highest seq wins. No CRDT library (tldraw itself abandoned pure CRDTs for canvas state; Yjs only reconsidered if M5 brings concurrent structured editing)
- [ ] Cards write back `{__duet:"setState", patch}` → server merges into `.state.json` → the agent reads/writes the same file with plain `fs`
- [ ] **Batch DOM patches** DEC-mode-2026-style (xterm 6 synchronized output as the conceptual template): buffer state updates, apply atomically, no tearing
- [ ] Client-injected card helper so template authors skip the postMessage plumbing: `duet.on(state => …)`, `duet.set(patch)`, `duet.emit(event)`
- [ ] `duet state get|set` CLI; example: a card slider and a terminal `duet state` read stay in sync with zero relay in either direction

### M3c — Direct stdin injection (card → terminal) · **build slot 7 · with M4, if ever**

- [ ] Event type that types a line into the session's PTY (`duet events --stdin <pane>`), for programs that only read stdin
- [ ] **Security gate:** this is the drive-by-RCE shape resurfacing from *inside a card* — arbitrary generated HTML must never type into the shell by default. Per-session opt-in **plus** a confirm chip in the terminal pane before any injected line runs. M3a/M3b deliver ~90% of the value without it. (Note: M-V's mic→stdin is user-initiated speech — a different threat model; it does not unlock this.)

### Cross-cutting

- [ ] **Data, not commands:** cards emit events; the agent decides what to do — keeps the sandbox boundary meaningful. Events/state accepted only from a card's own sandbox origin, size-capped, schema-validated. PROTOCOL.md bumped to v2 (additive)
- [ ] The `duet-canvas` skill updated to auto-wire event + state consumption both ways, so a fresh `claude` session reads card events and shared state with zero setup
- [ ] Examples: `examples/approve.sh` (renders approve/reject card, blocks on `duet await`, proceeds on click) and `examples/live-state.sh` (terminal + card sharing one `.state.json`)

Ship test: click a button in a card → the agent acts on it with no clipboard step; change a value in the terminal → the card updates without a re-render.

---

## M4 — Distribution · **build slot 8 · target Dec 15**

Goal: duet is an app you install, not a repo you clone.

- [x] **Competitive study gate — SATISFIED 2026-07-06** (deep-planning research: Wave/Warp/Ghostty + web-terminal + collab landscape) → positioning note at `docs/POSITIONING.md` naming what duet deliberately won't build. Watch item: Wave's Tsunami widget framework (WIP)
- [ ] Multi-window: each OS window is its own layout tree, sessions shared across windows
- [ ] GPU profile pass: verify the renderer inside the packaged webview, measure input-to-glyph latency, keep the <5ms budget (extends the M1.5 benchmark gate)
- [ ] **Sidecar → Rust decision**: with M1.5 sidecar data (binary-per-arch + codesign tax vs `portable-pty` rewrite cost), decide whether to port the PTY bridge to Rust
- [ ] Auto-update channel
- [ ] `brew tap` + cask publish; `duet` CLI symlinked on install
- [ ] **10-minute install test with 1 Bufalinda dev + 1 AIAC participant** — the brief's outcome gate
- [ ] **Publish the `duet-pack` plugin to the Bufalinda marketplace** (skills-track S4 — gated on the install test passing)

Ship test: `brew install --cask duet`, cold-start to interactive terminal < 1s.

---

## M5 — Multiplayer / remote · **build slot 9 · target 2027 Q1**

Goal: the session model stretches across machines and people without breaking the "canvas is a directory" contract. **Architecture template: sshx** (Rust relay, server-authoritative real-time, E2E encryption, read-only links).

- [ ] Remote attach over SSH: spawn the PTY on a remote host, sync the remote `$DUET_CANVAS` directory back (SSH channel + fs watch on the far side); local panes render remote cards identically — `.events.jsonl`/`.state.json` ship over the same channel
- [ ] `duet attach user@host` UX: session appears with a host badge; env vars set on the remote shell
- [ ] Read-only share links: a viewer URL exposing selected sessions (terminal output + canvas) with no input path — explicit opt-in, tokened, never default (duet stays 127.0.0.1-only otherwise). *(Boundary note: `/share-html` shares static annotated snapshots; duet share links share live sessions — different objects, both stay.)*
- [ ] Session recording: append-only log of PTY output frames (asciicast v3) + canvas events (already relative-time NDJSON per M3a) on one time base
- [ ] Replay: scrub a session timeline — asciinema-player drives the clock (play/pause/seek/markers API); canvas mounts/updates/events sync off `currentTime`
- [ ] PROTOCOL.md v3: remote sync semantics, recording format, share-links vs share-html boundary

Ship test: attach to a remote box, run the demo there, watch cards land locally; replay the whole thing tomorrow.

---

## M-V — Voice loop · **build slot 10 · target 2027 Q2 (soft)** — *last in queue by operator decision 2026-07-06*

Goal: talk to the agent in a pane and hear it answer — without parsing ANSI and without an embedded LLM. The voice loop rides the session protocol (M3a events), agent-agnostic like everything else.

- [ ] **V1 — TTS-back (the gap nobody ships):** CC Stop/Notification hooks (already producing events via the M3a bridge) emit speakable summaries → duet plays them via WebAudio TTS — Kokoro-82M local (Apache-2.0) or macOS AVSpeech. Filter recipe: skip >~300 chars, skip code-fence-leading, strip markdown. Barge-in: mic hot → stop playback + send `Esc` to the PTY
- [ ] **V2 — Local STT:** push-to-talk in the browser (`getUserMedia` → existing binary-WS) → whisper.cpp (Metal, MIT) → finalized text into PTY stdin. Private, offline, ~200–500ms. (Meanwhile CC's native `/voice` covers dictation for Claude.ai-authed users)
- [ ] Cloud realtime APIs (OpenAI Realtime, Gemini Live) = optional configured mode, never the local-first default
- [ ] Explicit non-goal: an embedded voice chat/LLM — duet hosts agents, it doesn't compete with them

Ship test: ask a question out loud, hear the agent's answer, never touch the keyboard.

---

## Design principles

1. **Never put rich content in the text stream.** The terminal carries text and (at most) short escape-sequence handles. Richness lives in linked panes. If it can't be grepped, it doesn't belong in the PTY.
2. **The canvas is a directory.** Every canvas feature must stay reachable by writing files — CLIs, sidecars, and escape sequences are conveniences layered on top, never requirements. No SDK, ever.
3. **Session color = linkage.** The one visual invariant: anything sharing a session shares its color. Users should be able to answer "which canvas does this terminal feed?" at a glance.
4. **Latency budget is law.** Terminal echo < 5ms local; file-write → pixels < 100ms. Any feature that would add work to the data path (compression, logging, JSON-wrapping PTY bytes) is rejected by default.
5. **Local-first, private by default.** `127.0.0.1` bind, strict card sandbox, opt-in only for anything that leaves the machine.
6. **Protect the wedge.** duet's differentiation vs Wave/Warp is protocol simplicity: any process renders by writing a file, and sessions link panes by color. New pane types and features must strengthen that wedge, not chase incumbent feature lists — when in doubt, ship the file-protocol version. (Positioning detail: `docs/POSITIONING.md`.)

## Open questions

- **Canvas GC policy** — canvas dirs persist across restarts (they're just files). Prune on session close? TTL? Never (user's files)? Probably: never delete automatically, but surface stale sessions in the UI with a one-key sweep.
- **Card ordering** — mtime-ascending breaks down once cards update frequently (updates preserve position today; but *new* cards land last). Do we need explicit order hints (sidecar? filename prefix convention?) and how do they interact with pin?
- **Huge-output guards** — 2 MiB card cap exists; what about a runaway process writing hundreds of cards, or a PTY flooding a slow client beyond the pause/resume window? Need per-session card-count caps and a defined degrade mode.
- **Multi-machine sessions** — when M5 syncs a remote canvas dir, which side owns truth on conflict? Is a session id globally unique or per-host (`host/session`)? Does `$DUET_EVENTS` traverse the SSH channel?
- **Card lifecycle vs. pane lifecycle** — closing the last pane of a session leaves a live watcher-less directory; should the session tray show "detached" sessions with card counts?
- **Editor-pane file scope (M2.5)** — which roots may an editor pane read/write? Per-session allowlist? cwd of the session's PTY? User-configured in `~/.duet/config`? The answer gates any file endpoint — localhost + Origin check alone is not a sufficient boundary for arbitrary file access.

*(Resolved 2026-07-06: shared-state merge semantics → per-field LWW-register, see M3b.)*
