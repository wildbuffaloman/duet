# duet wire contract — v1

This document is the normative reference for duet's protocol. Both sides (server and client), and anything that wants to interoperate with duet, implement **exactly** this.

## 0. Design requirements

**Performance is the #1 requirement.** Zero perceived terminal latency; file-write → pixels in **< 100ms** for HTML cards.

Data-path rules (non-negotiable):

- PTY bytes travel as **binary WebSocket frames** — never JSON-wrapped, never base64, never per-keystroke encoding.
- `perMessageDeflate: false` on the WebSocket server (compression adds latency and buffering).
- `socket.setNoDelay(true)` on every WebSocket connection (defeat Nagle batching).
- **No logging on the data path.**

## 1. HTTP server

- Framework: **express**. Bind **`127.0.0.1` only** — duet is a local tool and must never listen on external interfaces.
- Port **7433**; the `DUET_PORT` environment variable overrides it.

| Route | Serves |
| --- | --- |
| `GET /` | `public/index.html` (via `express.static('public')`) |
| `GET /health` | JSON `{"ok":true}` |
| `GET /vendor/xterm.css` | `node_modules/@xterm/xterm/css/xterm.css` |
| `GET /vendor/xterm.js` | `node_modules/@xterm/xterm/lib/xterm.js` |
| `GET /vendor/addon-fit.js` | `node_modules/@xterm/addon-fit/lib/addon-fit.js` |
| `GET /vendor/addon-webgl.js` | `node_modules/@xterm/addon-webgl/lib/addon-webgl.js` |

## 2. Sessions and the canvas directory

A **session** is the link between terminal panes and canvas panes. Its state on disk is a directory:

```
~/.duet/canvas/<sessionId>/
```

- `sessionId` **MUST** match `/^[a-z0-9-]{1,32}$/`. Reject anything else — no exceptions. This is the guard that keeps the canvas directory from ever escaping `~/.duet/canvas/`.
- The directory is created (`mkdir -p`) when the first PTY of the session spawns.

### The canvas-directory protocol

This is the beautiful part: **THE CANVAS IS A DIRECTORY.** Rendering is writing a file. There is no SDK, no client library, no RPC — any language, any tool, anything that can write a file can render.

| Filesystem action | Canvas effect |
| --- | --- |
| Write `<name>.html` into `$DUET_CANVAS` | A card appears in every canvas pane of the session (< 100ms) |
| Write `<name>.<png\|jpg\|jpeg\|gif\|webp\|svg>` into `$DUET_CANVAS` | Same — the image appears as a card (see *Image cards* below) |
| Overwrite the same file | The card updates **in place** (position and identity preserved) |
| Delete the file | The card is removed |

Card semantics:

- **id** — for an `.html` file, the filename without `.html`; for an image, the **full filename** (see *Image cards*). The id is the card's identity: same filename ⇒ same card.
- **title** — the `<title>` text if present; else the first `<h1>` text; else the id.
- **content** — the full file contents, rendered as a self-contained HTML document. Files must inline all CSS/JS; external URLs are not honored.
- **order** — cards are ordered by mtime, oldest first. Overwriting a card refreshes its content but is delivered as an update, not a re-mount.

### Image cards

`cp chart.png "$DUET_CANVAS"` renders it. No conversion step, no CLI — the file *is* the card,
exactly like HTML.

The server wraps the image in a minimal self-contained document whose `<img>` carries the bytes as
a **`data:` URI**. This is deliberate, not a shortcut: cards render in `sandbox="allow-scripts"`
iframes with no same-origin, and the protocol does not honor external URLs — so a `data:` URI is
the only form that needs no new HTTP route, no sandbox relaxation, and no client change. An image
card is therefore a normal card in every respect; nothing downstream knows the difference.

- **id** — the **full filename**, extension included (`chart.png`). Two reasons: stripping a
  4-letter extension with the `.html` rule would mangle it (`chart.png` → `char`), and keeping the
  extension guarantees `chart.png` can never collide with `chart.html`. `.html` id derivation is
  unchanged, so §5.1 card→card links keep working.
- **title** — the filename without its extension (`chart`).
- **size cap** — images above **8 MiB** are skipped (base64 inflates ~33%; this bounds the WS frame
  while still covering Retina screenshots). HTML cards keep their own 2 MiB cap.
- **SVG** — served as `image/svg+xml` inside an `<img>`, where scripts never execute per spec.

## 3. WS endpoint 1 — `/term` (terminal ↔ PTY)

```
GET /term?pane=<paneId>&session=<sessionId>&cols=<n>&rows=<n>   (WebSocket upgrade)
```

**On connect** the server spawns one PTY via `@lydell/node-pty`:

| Parameter | Value |
| --- | --- |
| `file` | `process.env.SHELL \|\| '/bin/zsh'` |
| `args` | `['-l']` |
| `cwd` | `os.homedir()` |
| `name` | `'xterm-256color'` |
| `cols` / `rows` | from the query string |
| `env` | `{...process.env, DUET_SESSION: sessionId, DUET_CANVAS: <canvasDir>, TERM: 'xterm-256color', COLORTERM: 'truecolor'}` |

- `canvasDir` is `~/.duet/canvas/<sessionId>/`, `mkdir -p`'d on spawn. `sessionId` is validated per §2 before any filesystem or PTY work.
- **One PTY per `/term` connection.** `paneId` is informational/logging only; it carries no protocol meaning.

**Frames:**

| Direction | Frame type | Meaning |
| --- | --- | --- |
| client → server | **binary** | Raw input bytes → `pty.write(<utf8 string of bytes>)` |
| client → server | text | JSON `{"type":"resize","cols":<n>,"rows":<n>}` → `pty.resize(cols, rows)` |
| server → client | **binary** | PTY output: `pty.onData(d => ws.readyState === 1 && ws.send(Buffer.from(d)))` |
| server → client | text | JSON `{"type":"exit","code":<n>}` on PTY exit, then the server closes the socket |

**Lifecycle:** PTY exit → send `{type:'exit', code}` → `ws.close()`. WebSocket close (either side, any reason) → `pty.kill()`. No orphan PTYs.

## 4. WS endpoint 2 — `/canvas` (canvas subscription)

```
GET /canvas?session=<sessionId>   (WebSocket upgrade)
```

**On connect** the server sends one text frame:

```json
{"type":"snapshot","cards":[Card, ...]}
```

containing every `*.html` file in the session's canvas directory, sorted by **mtime ascending**.

**Card object:**

```json
{"id": "<filename without .html>", "title": "<see §2>", "mtime": <ms>, "html": "<full file contents>"}
```

**Live updates** — the server runs one chokidar watcher per session directory, **refcounted** across subscribers and closed when the last subscriber disconnects. Watcher options:

```js
{ ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 }, depth: 0 }
```

(`awaitWriteFinish` is what guarantees cards never render from a half-written file while keeping the write→pixels budget under 100ms.)

| Filesystem event | Frame to all subscribers |
| --- | --- |
| `add` / `change` of `*.html` | text `{"type":"card","card":Card}` |
| `unlink` of `*.html` | text `{"type":"remove","id":"<id>"}` |

**SECURITY:** the server only reads files whose basename matches `/^[A-Za-z0-9._-]+\.html$/` and which live **directly** inside the session's canvas directory (`depth: 0`, never follow `../` or any path containing a separator). Combined with the `sessionId` regex in §2, no request can name a file outside `~/.duet/canvas/<sessionId>/`.

## 5. Client contract

Vendor scripts are UMD builds served from `/vendor/*` (§1) and expose globals:

- `window.Terminal`
- `window.FitAddon.FitAddon`
- `window.WebglAddon.WebglAddon`

Terminal wiring:

- `ws.binaryType = 'arraybuffer'`
- Keystrokes: `term.onData(s => ws.send(new TextEncoder().encode(s)))` — sent as a **binary** frame.
- Output: incoming binary frame → `term.write(new Uint8Array(buf))`.
- Resize: on pane resize, fit the terminal and send the text frame `{"type":"resize","cols":<n>,"rows":<n>}`.
- Renderer: attempt the WebGL addon inside `try/catch`; on any failure fall back **silently** to xterm.js's canvas renderer.

## 5.1 Card links (navigating between cards)

Cards render in sandboxed iframes (`allow-scripts` only), so ordinary hyperlinks cannot navigate
anything — by design. Instead, duet injects a tiny click handler (LINKER) into **every** card, so
card authors need zero boilerplate. To link from one card to another, write either form:

```html
<a href="duet:deep-termws">deep dive: /term bridge</a>
<button data-duet-card="deep-termws">deep dive</button>   <!-- any element works -->
```

- A click posts `{__duet:"open", card:"<id>"}` to the parent. The client matches the message's
  `ev.source` against card iframe `contentWindow`s (unforgeable across frames), so **only the pane
  that hosts the clicked card navigates** — other panes, even on the same session, are unaffected.
- Card ids are filenames without `.html` (§2). In **focus view** the pane shows the target card
  (pinning it, or resuming follow-latest if the target is the newest card). In **list view** the
  pane scrolls to the target card and flashes it.
- Linking to a card that does not exist yet shows a toast today. The planned M3 back-channel will
  surface these unresolved opens to producers so an agent can generate the artifact on demand and
  the link resolves on arrival.
- Suggested slug convention for module documentation: `module-<name>` for UIs, `deep-<name>` for
  deep dives — stable ids that generated HTML can target before the files exist.

## 6. Environment variables (inside every duet terminal)

| Variable | Value | Meaning |
| --- | --- | --- |
| `DUET_SESSION` | the session id | Which session this shell belongs to |
| `DUET_CANVAS` | `~/.duet/canvas/<sessionId>/` (absolute) | Write `.html` files here to render cards |
| `TERM` | `xterm-256color` | Standard terminal type |
| `COLORTERM` | `truecolor` | 24-bit color advertised |

The presence of `DUET_CANVAS` is the canonical "am I inside duet?" check for scripts and agents.

## 7. Versioning

This is **v1** of the wire contract. Any breaking change to frame shapes, routes, card semantics, or the canvas-directory rules requires a version bump and a new section in this document.
