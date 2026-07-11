# FB-2 / FB-3 — Drag a file onto a pane · Delete a card (design)

**Date:** 2026-07-11 · **Status:** approved · **Depends on:** FB-1 (image cards, `lib/cards.js`)

FB-3 (delete a card) is folded in because it lands on the same surface FB-2 opens: a validated
**inbound message on the canvas WebSocket**. Both are "the client asks the server to mutate the
canvas directory, because JS cannot touch the filesystem." Building that plumbing once is the whole
reason they ship together.

## Problem

To feed a file to an agent in a duet terminal (an image for Claude Code, a CSV, a log), you must
type its absolute path by hand. Every other terminal — Ghostty included — lets you drag the file
onto the terminal and inserts its path at the cursor. duet has **no drag-drop handling at all**
today: not in Rust, not in JS.

## Goal

Drag a file onto a duet pane and have the obvious thing happen:

- **Terminal pane** → the file's real path is inserted (shell-escaped) into the input line, as if
  typed. Nothing executes. This is the ask.
- **Canvas pane** → the file is copied into `$DUET_CANVAS` and renders as a card, reusing FB-1.

One mental model: *the drop does the right thing for the pane you dropped on.*

And the inverse of a drop (FB-3): **remove a card from the canvas** — html or image — from the UI,
instead of having to `rm` the file by hand.

## Non-goals

- **Browser flow.** A browser cannot see a dropped file's real path — HTML5 hands over bytes and a
  filename, never `/Users/you/shot.png`. That is a security boundary, not a duet limitation. In the
  browser, a drop is an inert no-op. (A future "upload the bytes and insert the copy's path"
  fallback is a separate backlog item; the inserted path would point at a copy, not the original,
  which is a different feature.)
- No auto-execute. No newline is ever inserted.
- No new HTTP endpoint (see Security).

## Constraints that shape the design

1. **Only native code can read dropped paths.** Therefore Rust (Tauri) must handle the drop.
2. **Tauri's `dragDropEnabled` defaults to `true`**, so the webview already swallows OS drops and
   HTML5 `drop` events never fire in duet.app. Whoever handles this *must* be Tauri. No config
   change is needed — the default is what we want.
3. **The pane hit-test lives in JS.** The layout tree is client state; Rust has no idea where the
   panes are. So Rust must hand the drop to JS.
4. **duet.app loads a remote URL** (`http://127.0.0.1:7433`), not a bundled asset. This is exactly
   the case where Tauri IPC / `window.__TAURI__` injection requires explicit remote-origin
   capability config. `webview.eval()` has no such requirement.
5. **Tauri reports drop position in physical pixels; `elementFromPoint` wants CSS pixels.** On a
   Retina display the scale factor is 2, so an uncorrected coordinate lands at double the position
   and silently hits the wrong pane (or none). It would appear to "work" on a 1x external display
   and break on the laptop. Rust divides by `window.scale_factor()` before handing coordinates over.

## Architecture

```
OS drop
  │
  ▼
src-tauri/lib.rs   on_drag_drop_event → paths + physical position
  │                scale-correct: css = physical / scale_factor()
  │                webview.eval(`window.__duetDrop(<paths>, x, y)`)   ← one-way, no IPC perms
  ▼
public/app.js      window.__duetDrop(paths, x, y)
  │                elementFromPoint(x, y) → enclosing pane
  ├── terminal ──► focus + term.paste(escaped)         (bracketed-paste aware)
  └── canvas   ──► ws.send({type:'import', path})      (that pane's already-open canvas WS)
                          │
                          ▼
                   server.js  validate + copy into $DUET_CANVAS
                          │
                          ▼
                   chokidar → buildCard() → card broadcast   (FB-1, already shipped)
```

### Components

| Unit | Purpose | Depends on |
| --- | --- | --- |
| `src-tauri/lib.rs` | Catch the OS drop, scale-correct, `eval` into the page | Tauri window |
| `lib/shell-escape.js` *(new, pure)* | POSIX-escape a path for insertion | nothing |
| `public/app.js` → `window.__duetDrop` | Hit-test the pane, route by pane type | panes, xterm, canvas WS |
| `public/app.js` → card ✕ button | Ask the server to delete a card | canvas WS |
| `server.js` canvas WS inbound | Handle `import` (copy) and `delete` (unlink) | `lib/cards.js` |
| `lib/cards.js` → `findCardFile(dir, id)` *(new)* | Resolve a card id back to its real file | nothing |

## Behavior

**Terminal drop.** Insert `escape(path)` for each dropped file, space-joined, plus a **trailing
space**. No newline — Ghostty parity, nothing executes. Delivered via `term.paste()`, which honors
**bracketed paste**, so the text lands as literal, editable content in Claude Code's input box
rather than being interpreted. The dropped-on pane takes focus. Works for *any* file type, not just
images — it is a path feature, not an image feature.

**Escaping.** If the path contains only `[A-Za-z0-9_./-]`, insert it raw. Otherwise wrap in single
quotes, encoding any embedded single quote as `'\''`. This is POSIX-safe and survives spaces,
apostrophes ("Alberto's Mac"), parentheses, and unicode.

**Canvas drop.** Send `{type:'import', path}` over that canvas pane's open WebSocket. The server
copies the file into that session's canvas dir. FB-1's watcher renders it. Unsupported file types
are ignored (a canvas can only show what `buildCard` can build).

**No pane under the cursor** → ignore silently.

**Delete a card (FB-3).** Each card gets a ✕ in its header. Clicking it sends
`{type:'delete', id}` on that pane's canvas WS. The server resolves the id to a real file and
unlinks it. The existing chokidar `unlink` handler then broadcasts `{type:'remove', id}` — which
**already works and is already tested** (FB-1's mutation test proves it carries the unmangled id).
So the server side is one resolve + one unlink; the removal path is free.

**Resolving an id back to a file** is the delicate part, and it is deliberately *not* done by
reconstructing a filename from the id (`foo` → `foo.html`, `chart.png` → `chart.png`). String
reconstruction is where traversal bugs breed. Instead `findCardFile(dir, id)` **reads the canvas
directory and returns the entry whose `cardIdFor(name) === id`**. We can therefore only ever unlink
a name we literally just found inside that directory — escaping it is structurally impossible,
not merely validated against. An id that matches nothing is a silent no-op.

## Security

`import` (copy a file in) and `delete` (unlink a card) are the new capabilities, so they get the
scrutiny. Both ride the **existing canvas WebSocket**, deliberately:

- That socket is already **Origin-checked on upgrade**, so a hostile web page cannot open one. A new
  HTTP route would have no such check today and would hand any page on the internet a
  "copy an arbitrary file" primitive on localhost. duet has already eaten one drive-by-RCE; the
  ROADMAP gates "path-scoping before any file endpoint ships" (M2.5). We do not open that surface
  for a convenience feature.
- The socket is already **session-scoped** (`sessionId` validated against `SESSION_RE` on upgrade),
  so the destination directory cannot escape `~/.duet/canvas/<session>/`.
- The **destination basename is sanitized** to the card-file regex and stripped of any path
  separator, so a crafted source name cannot traverse out of the canvas dir.
- The **8 MiB cap** (FB-1) applies to the copy.
- The source path originates from a real OS drag-drop the user physically performed.
- **Delete can only unlink a name read out of that session's canvas dir** (`findCardFile`), so it
  cannot be pointed at a file elsewhere on disk no matter what id is sent.
- **Terminal control bytes are stripped before a path is pasted** (`stripControlBytes`, applied in
  both `shellEscape` and the terminal-paste boundary). A filename may legally embed ESC on
  macOS/Linux; pasted raw it could smuggle the bracketed-paste END marker (`ESC[201~`) past the
  paste boundary and be interpreted as terminal input. Shell quoting protects the shell; this
  protects the terminal. (Security review 2026-07-11.)

## Testing

| Level | Covers |
| --- | --- |
| Unit (TDD) | `shell-escape`: safe paths raw; spaces; embedded single quotes; multi-file join |
| Unit (TDD) | import validation: basename sanitized, traversal rejected, unsupported type rejected, cap enforced |
| Unit (TDD) | `findCardFile`: resolves html + image ids; returns null for unknown; never returns a name outside the dir |
| Integration | canvas WS `import` → file copied → `card` broadcast (extends `test/canvas-ws.test.js`) |
| Integration | canvas WS `delete` → file unlinked → `remove` broadcast |
| Manual | Rust `eval` + hit-test: drag a real file onto a terminal pane and onto a canvas pane in duet.app; click ✕ on a card |

The Rust→JS bridge and the coordinate hit-test are the parts automated tests can't reach; they are
verified by hand in the running app, and the scale-factor correction is the specific thing to check
(drop near a pane edge on the Retina display).

## Deferred

- Browser upload-fallback (insert the path of a server-side copy).
- Optional `@`-prefix for Claude Code file-reference syntax — Ghostty parity means raw path for now.
- Drag *out* of a canvas card (export).
