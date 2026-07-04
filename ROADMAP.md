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

## M2.5 — Editor pane spike (third pane type) — *investigation*

Goal: decide whether panes grow a third type — `editor` — without duet becoming a worse IDE. The WM already treats pane type as data (`term | render` + in-place toggle), so the plumbing is cheap; this milestone is about validating the *product* shape, not the splits.

- [ ] **Spike: CodeMirror 6 editor pane** — third case in the pane-body switch + split-popover option; file open/save via new scoped server endpoints; syntax highlighting, dirty indicator. Timebox it: if it doesn't feel duet-native in a week, kill it
- [ ] **Session-linked follow mode ("watch the agent edit")** — the duet-native twist that justifies the pane type: an editor pane bound to a session auto-opens the file the agent most recently touched, reusing focus view's follow-latest/pin semantics. Validate this before generic editing — it's the differentiator
- [ ] **Path-scoping decision before any file endpoint ships** — an editor pane widens the server from canvas-dir writes to arbitrary file read/write on localhost; define allowlisted roots per session (Origin check alone is not enough). Blocks the spike from merging
- [ ] **Cheap alternative to beat**: "open in editor" handles (card/terminal chip that opens the file in Zed/VS Code) — if this captures most of the value, the editor pane loses the decision
- [ ] **Explicit non-goals**: LSP, git UI, debugger, project-wide search — that's Zed/Cursor's company, not a pane type

Decision test: after a week of the spike, "watch the agent edit" is something you actually leave open — otherwise ship the open-in-editor handle and close the milestone.

---

## M3 — Tight loop: messaging & state sharing between cards and the session

Goal: **eliminate manual relay between screens.** Today the human is the message bus — copying a card's compiled prompt into the terminal, retyping terminal state into a card, re-rendering a whole file to change one number. M3 makes cards and the programs that rendered them share events and state natively, so a form in a card drives the program directly and a value the program changes updates the card without a re-render. Built the duet way: **the session dir is the API (`.events.jsonl`, `.state.json`), the WebSocket is only the accelerator (<100ms), and the transport stays file-portable, language-agnostic, greppable.** Three tiers, each killing a class of manual relay:

### M3a — Events out of cards (card → agent/script) — *the copy-paste killer; sequence first*

Highest daily-friction payoff, and the primitive already half-exists: the M2 card→card link handler already ships clicks from a sandboxed card to the client via `postMessage` with unforgeable `contentWindow` matching.

- [ ] Generalize the shipped card→card link channel (PROTOCOL.md §5.1): a card posts `{__duet:"event", payload}` → client relays over the already-open canvas WS → server appends one JSON line to `~/.duet/canvas/<session>/.events.jsonl` (advertised as `$DUET_EVENTS`). Same `contentWindow` guard keeps the source card unforgeable
- [ ] Card bridge: `data-duet-event` buttons and form submits emit `{card, type, data}`; **the template library's "Copy feedback" button becomes "Send to session"** inside duet (clipboard demoted to the standalone-only fallback — supersedes template rule #5)
- [ ] Consume with zero HTTP in a script: `duet await` (blocks, prints next event on stdout for `$(…)` capture) and `duet events` (tails as line-JSON for `while read -r ev; do …`)
- [ ] No-reader/backpressure semantics: non-blocking append, bounded buffer, dropped-with-counter when nothing is tailing

### M3b — Shared session state (both directions) — no re-render to change one value

- [ ] One `~/.duet/canvas/<session>/.state.json` per session (advertised as `$DUET_STATE`). Server watches it; on change pushes `{__duet:"state", data}` to every card in the session over the open WS — cards patch their DOM live, no file rewrite
- [ ] Cards write back `{__duet:"setState", patch}` → server merges into `.state.json` → the agent reads/writes the same file with plain `fs`. A chart card and a terminal script converge on shared live variables — tightest coupling, still "just a file"
- [ ] Client-injected card helper so template authors skip the postMessage plumbing: `duet.on(state => …)`, `duet.set(patch)`, `duet.emit(event)`
- [ ] `duet state get|set` CLI; example: a card slider and a terminal `duet state` read stay in sync with zero relay in either direction

### M3c — Direct stdin injection (card → terminal) — *gated, opt-in, ship last or never*

- [ ] Event type that types a line into the session's PTY (`duet events --stdin <pane>`), for programs that only read stdin
- [ ] **Security gate:** this is the drive-by-RCE shape resurfacing from *inside a card* — arbitrary generated HTML must never type into the shell by default. Per-session opt-in **plus** a confirm chip in the terminal pane before any injected line runs. M3a/M3b deliver ~90% of the value without it

### Cross-cutting

- [ ] **Data, not commands:** cards emit events; the agent decides what to do — keeps the sandbox boundary meaningful. Events/state accepted only from a card's own sandbox origin, size-capped, schema-validated. PROTOCOL.md bumped to v2 (additive)
- [ ] M2's Claude Code skill updated to auto-wire event + state consumption both ways, so a fresh `claude` session reads card events and shared state with zero setup
- [ ] Examples: `examples/approve.sh` (renders approve/reject card, blocks on `duet await`, proceeds on click) and `examples/live-state.sh` (terminal + card sharing one `.state.json`)

Ship test: click a button in a card → the agent acts on it with no clipboard step; change a value in the terminal → the card updates without a re-render.

---

## M4 — App packaging

Goal: duet is an app you install, not a repo you clone.

- [ ] **Competitive study gate: Wave Terminal (+ Warp blocks)** before packaging investment — Wave is the closest incumbent (open-source, block-based, inline rich previews, editor-ish blocks). Map feature overlap and confirm duet's wedge still holds: canvas-is-a-directory (zero SDK — renders whatever *your agent* writes, not widgets the vendor built), session-linked pane groups, agent-agnostic local-first. Output: a positioning note in `docs/` naming what duet deliberately won't build
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
6. **Protect the wedge.** duet's differentiation vs Wave/Warp is protocol simplicity: any process renders by writing a file, and sessions link panes by color. New pane types and features must strengthen that wedge, not chase incumbent feature lists — when in doubt, ship the file-protocol version.

## Open questions

- **Canvas GC policy** — canvas dirs persist across restarts (they're just files). Prune on session close? TTL? Never (user's files)? Probably: never delete automatically, but surface stale sessions in the UI with a one-key sweep.
- **Card ordering** — mtime-ascending breaks down once cards update frequently (a live dashboard keeps jumping… except updates preserve position today; but *new* cards land last). Do we need explicit order hints (sidecar? filename prefix convention?) and how do they interact with pin?
- **Huge-output guards** — 2 MiB card cap exists; what about a runaway process writing hundreds of cards, or a PTY flooding a slow client beyond the pause/resume window? Need per-session card-count caps and a defined degrade mode.
- **Multi-machine sessions** — when M5 syncs a remote canvas dir, which side owns truth on conflict? Is a session id globally unique or per-host (`host/session`)? Does `$DUET_EVENTS` traverse the SSH channel?
- **Card lifecycle vs. pane lifecycle** — closing the last pane of a session leaves a live watcher-less directory; should the session tray show "detached" sessions with card counts?
- **Shared-state merge semantics (M3b)** — when a card `setState` patch and an agent `fs` write to `.state.json` race, who wins? Last-write-wins on the whole file loses concurrent edits; a shallow-merge patch protocol is safer but needs a defined conflict rule and a max event/patch rate before the <100ms budget slips. Also: is `.state.json` per-session only, or can cards scope keys to a single card id?
- **Editor-pane file scope (M2.5)** — which roots may an editor pane read/write? Per-session allowlist? cwd of the session's PTY? User-configured in `~/.duet/config`? The answer gates any file endpoint — localhost + Origin check alone is not a sufficient boundary for arbitrary file access.
