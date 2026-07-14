# CLAUDE.md — duet

> **Vault Project Brief:** `01 PROJECTS/Duet — Tiling Agent Terminal/Duet — Tiling Agent Terminal.md`

duet is a local tiling agent terminal: every pane is a real terminal (PTY + xterm.js/WebGL) or a
live HTML render surface, linked by *session*. The canvas is a directory — writing a self-contained
`.html` file to `$DUET_CANVAS` (`~/.duet/canvas/<session>/`) renders a live card. Transport is
raw binary WebSockets (no JSON/base64 on the PTY path, no compression, `TCP_NODELAY`) for zero
perceived latency. Server binds `127.0.0.1` only; card iframes are `sandbox="allow-scripts"` (no
same-origin). Open with `bin/duet-app` — NEVER a claude.ai URL.

## Project rules

- **Content-scanning lints/guards gate on API *usage*, not bare-word.** A check for sandbox-unsafe
  APIs must match a call/member form (`fetch(`, `localStorage.`/`[`, `new WebSocket`) — never the
  bare token. A bare-word match false-positives on any file whose *content* merely names the API
  (e.g. a template describing localStorage in its data), and the false positive is unfixable without
  lossily editing legitimate content. See `templates/lint-templates.js`. (retro 2026-07-04)

- **HTML templates: the CRITIQUE-KIT fence is byte-identical across the library.** Never hand-edit
  a template's fenced kit; fixes propagate to `_skeleton.html` then to every fence by grep, verified
  with `diff`. When generating a template family programmatically, extract the shared block from the
  source-of-truth file and splice — don't retype. Lint gate: `node templates/lint-templates.js`.
  Full conventions: `templates/README.md` + the canonical vault library
  (`03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`).
