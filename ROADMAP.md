# duet — Roadmap

**Vision.** Text drives, canvas shows. The terminal stays what it has always been — greppable, pipeable, plain text — while everything rich (charts, tables, previews, dashboards) lives in linked panes fed by the world's simplest render protocol: *write an `.html` file into a directory*. A session is the linkage; an agent or script that can write a file can render; and nothing on the data path is allowed to cost latency. duet should feel like Ghostty with a second sense.

---

## M0 — MVP ✅ (shipped)

What exists today (see `README.md`, `docs/PROTOCOL.md` v1, `server.js`, `public/app.js`):

- [x] BSP tiling in the browser: split right/down, flip a split (row↔col), drag-to-resize seams, close, swap, hide-to-tray/restore, layout persisted in localStorage
- [x] Every pane is a real terminal (PTY via `@lydell/node-pty`) **or** a render surface; toggle a pane's type in place
- [x] Sessions link panes; per-session color; reassign a pane's session
- [x] Canvas-directory protocol: `~/.duet/canvas/<sessionId>/`, write/overwrite/delete `*.html` ⇒ card mount/update/remove; `<title>` ⇒ card title; mtime ordering; 2 MiB card guard
- [x] `DUET_SESSION` / `DUET_CANVAS` injected into every PTY env
- [x] Transport per the v1 wire contract: binary WS frames for PTY bytes, `perMessageDeflate: false`, `TCP_NODELAY`, no logging on the data path; PTY backpressure (pause/resume at 1 MiB buffered)
- [x] WebGL xterm renderer with silent canvas fallback; refcounted chokidar watcher per session (`awaitWriteFinish` 40ms)
- [x] Security: `127.0.0.1` bind only, sessionId regex, basename-only card reads (`depth: 0`), Origin check on WS upgrade
- [x] `bin/duet` launcher (health-poll then open browser), `examples/demo.sh`, `examples/claude-instructions.md`, light/dark theme

---

## M1 — Daily-driver polish

Goal: replace your terminal app for a full workday without reaching for the mouse.

- [ ] Keyboard splits & navigation: `cmd+d` split right, `cmd+shift+d` split down, `cmd+alt+←/→/↑/↓` focus pane by direction, `cmd+w` close, `cmd+shift+enter` — all routed so they never collide with shell keybindings
- [ ] Pane zoom: temporarily maximize the focused pane (`cmd+shift+z` toggle), layout preserved underneath
- [ ] Layout presets: save/restore named layouts (tree + pane types + session bindings), quick-switch from the toolbar
- [ ] Session rename: editable name (id stays immutable — it's the directory), name shown in legend + pane headers
- [ ] Terminal search: `cmd+f` in-pane find via `@xterm/addon-search`, with match count and highlight
- [ ] Reconnect resilience: server restart or WS drop → client auto-reconnects with backoff, re-fits terminals, re-snapshots canvases; a dead PTY pane offers one-key respawn instead of going blank
- [ ] Config file `~/.duet/config` (JSON or TOML): port, default shell/args, font family/size, theme, scrollback, keybinding overrides, default session count
- [ ] Scrollback + copy-mode basics: configurable scrollback, `cmd+k` clear

Ship test: a full day of real work in duet with zero mouse usage for pane management.

---

## M2 — Deep agent integration

Goal: agents treat the canvas as a first-class output device, and cards are addressable from the text stream.

- [x] **Card→card links** (shipped early): duet injects a click handler into every card, so `<a href="duet:<id>">` or any `[data-duet-card]` element navigates the hosting pane to that card via postMessage (PROTOCOL.md §5.1). Same "handle" primitive as below, triggered from canvas HTML instead of the text stream; unresolved targets toast today and become M3 generate-on-demand events later.
- [ ] **Handles in the text stream**: an OSC 1337-style escape sequence (e.g. `OSC 1337;Duet=handle;card=<id> ST`) a CLI can emit; the client parses it out of the PTY stream and renders an inline "chip" that focuses/flashes the referenced card on click. Printed fallback stays greppable: `duet handle <card>`
- [ ] **`duet` CLI** (extend `bin/duet` with subcommands, all pure-filesystem so they work over the existing protocol):
  - [ ] `duet render <file> [--as <id>]` — copy/normalize a file into `$DUET_CANVAS` (md → self-contained html later)
  - [ ] `duet title <id> <title>` — rewrite a card's `<title>` in place
  - [ ] `duet clear [<id>]` — remove one card or the whole session canvas
  - [ ] `duet handle <id>` — emit the handle escape + text fallback
- [ ] **Claude Code skill packaging**: turn `examples/claude-instructions.md` into a proper skill/plugin so `claude` auto-discovers `$DUET_CANVAS` (trigger: env var present) — no CLAUDE.md paste needed
- [ ] Per-card **pin** (keep at top regardless of mtime order) and **collapse** (title-bar only), persisted client-side
- [ ] Card metadata sidecar convention (`<id>.json`, optional): pin/order hints written by tools — protocol stays "just files"

Ship test: `claude` in a fresh duet pane renders a chart to the canvas and prints a clickable handle, with zero setup.

---

## M3 — Interactivity back-channel

Goal: cards become bidirectional UIs — a form in a card can drive the program that rendered it.

- [ ] `$DUET_EVENTS` fifo per session (created alongside `$DUET_CANVAS`), advertised in the PTY env
- [ ] Card sandbox exposes a tiny bridge: form submits and `data-duet-event` button clicks POST to the server (`POST /event?session=…`), which writes one JSON line per event to the fifo: `{"card":"<id>","type":"submit|click","data":{…}}`
- [ ] Backpressure/no-reader semantics defined: non-blocking writes, bounded buffer, events dropped (with counter) when nothing reads the fifo
- [ ] `duet events` CLI subcommand: tail the fifo as line-JSON for shell scripts (`while read -r ev; do …`)
- [ ] Optional stdin mode: `duet events --stdin <pane>` bridges events into the focused terminal as typed lines, for programs that only read stdin
- [ ] Security pass: events accepted only from the card's own sandbox origin, size-capped, schema-validated; PROTOCOL.md bumped to v2 (additive)
- [ ] Example: `examples/approve.sh` — script renders an approve/reject card, blocks on the fifo, proceeds on click

Ship test: a shell script renders a form, a human clicks a button in the card, the script continues — no HTTP code in the script.

---

## M4 — App packaging

Goal: duet is an app you install, not a repo you clone.

- [ ] Tauri shell (preferred — tiny, fast; Electron only if webview terminal perf disappoints in measurement): bundle server + UI, spawn node sidecar or port server to the Tauri process
- [ ] Native menus + macOS keybinding conventions; dock icon, badge on canvas activity
- [ ] Multi-window: each OS window is its own layout tree, sessions shared across windows
- [ ] GPU profile pass: verify WebGL renderer inside the packaged webview, measure input-to-glyph latency, keep the <5ms budget
- [ ] Single-instance guard + "attach to running server" behavior (today's `bin/duet` health-poll logic, promoted)
- [ ] Auto-update channel
- [ ] `brew tap` + cask publish; `duet` CLI symlinked on install

Ship test: `brew install --cask duet`, cold-start to interactive terminal < 1s.

---

## M5 — Multiplayer / remote

Goal: the session model stretches across machines and people without breaking the "canvas is a directory" contract.

- [ ] Remote attach over SSH: spawn the PTY on a remote host, sync the remote `$DUET_CANVAS` directory back (SSH channel + fs watch on the far side); local panes render remote cards identically
- [ ] `duet attach user@host` UX: session appears with a host badge; env vars set on the remote shell
- [ ] Read-only share links: a viewer URL exposing selected sessions (terminal output + canvas) with no input path — explicit opt-in, tokened, never default (duet stays 127.0.0.1-only otherwise)
- [ ] Session recording: append-only log of PTY output frames + canvas events with timestamps
- [ ] Replay: scrub a session timeline — terminal playback synchronized with card mounts/updates
- [ ] PROTOCOL.md v3: remote sync semantics, recording format

Ship test: attach to a remote box, run the demo there, watch cards land locally; replay the whole thing tomorrow.

---

## Design principles

1. **Never put rich content in the text stream.** The terminal carries text and (at most) short escape-sequence handles. Richness lives in linked panes. If it can't be grepped, it doesn't belong in the PTY.
2. **The canvas is a directory.** Every canvas feature must stay reachable by writing files — CLIs, sidecars, and escape sequences are conveniences layered on top, never requirements. No SDK, ever.
3. **Session color = linkage.** The one visual invariant: anything sharing a session shares its color. Users should be able to answer "which canvas does this terminal feed?" at a glance.
4. **Latency budget is law.** Terminal echo < 5ms local; file-write → pixels < 100ms. Any feature that would add work to the data path (compression, logging, JSON-wrapping PTY bytes) is rejected by default.
5. **Local-first, private by default.** `127.0.0.1` bind, strict card sandbox, opt-in only for anything that leaves the machine.

## Open questions

- **Canvas GC policy** — canvas dirs persist across restarts (they're just files). Prune on session close? TTL? Never (user's files)? Probably: never delete automatically, but surface stale sessions in the UI with a one-key sweep.
- **Card ordering** — mtime-ascending breaks down once cards update frequently (a live dashboard keeps jumping… except updates preserve position today; but *new* cards land last). Do we need explicit order hints (sidecar? filename prefix convention?) and how do they interact with pin?
- **Huge-output guards** — 2 MiB card cap exists; what about a runaway process writing hundreds of cards, or a PTY flooding a slow client beyond the pause/resume window? Need per-session card-count caps and a defined degrade mode.
- **Multi-machine sessions** — when M5 syncs a remote canvas dir, which side owns truth on conflict? Is a session id globally unique or per-host (`host/session`)? Does `$DUET_EVENTS` traverse the SSH channel?
- **Card lifecycle vs. pane lifecycle** — closing the last pane of a session leaves a live watcher-less directory; should the session tray show "detached" sessions with card counts?
