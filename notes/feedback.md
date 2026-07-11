# Feedback — duet (play sessions)

Running punch-list of gaps hit while using the app. Distinct from the brief's *Friction Log*
(which is replacement-test fallback events); this is feature/UX feedback that feeds the M1 build.

Status: `open` → `in-progress` → `done` (commit) / `wontfix` (with reason).

| # | Date | Item | Why blocked today | Fix shape | Size | Status |
|---|------|------|-------------------|-----------|------|--------|
| 1 | 2026-07-10 | Need to be able to load images into the canvas | `CARD_FILE_RE` (server.js:21) only matches `.html`; image files in the canvas dir are ignored. Cards are `sandbox="allow-scripts"` (no same-origin) + external URLs unhonored → HTML cards can't `<img src>` a sibling file either. | Server treats `.png/.jpg/.jpeg/.gif/.svg/.webp` as cards: read bytes → base64 data-URI → wrap in minimal self-contained `<img>` doc → send as card `html`. No client/sandbox/route change. Cap 8 MiB to bound the WS frame. | S | **done** (`fb1-canvas-images`) |

| 2 | 2026-07-11 | Drag a file onto a terminal pane → its path is inserted into the input line (Ghostty parity) | No drag-drop handling exists at all (Rust or JS). Tauri's `dragDropEnabled` defaults true → the webview swallows OS drops and HTML5 `drop` never fires. Only native code can see a dropped file's real path. | Rust `on_drag_drop_event` → scale-correct → `eval(window.__duetDrop(paths,x,y))` → JS hit-tests the pane → terminal: `term.paste(shellEscape(path))`; canvas: `{type:'import'}` over the pane's open canvas WS → server copies into `$DUET_CANVAS` → FB-1 renders it. Spec: `docs/superpowers/specs/2026-07-11-drag-drop-path-insert-design.md` | M | in-progress |
| 3 | 2026-07-11 | Delete an html/image card from the canvas | Cards can only be removed by `rm`-ing the file — there's no UI affordance. JS can't touch the filesystem. | Rides the SAME canvas-WS inbound channel as FB-2's import: `{type:'delete', id}` → server resolves the id to its file, unlinks it inside the session canvas dir only → the existing chokidar `unlink` → `remove` broadcast already works. Plus a per-card ✕ in the card header. | S | open |

## Notes

**FB-1 (2026-07-10).** Card logic extracted to `lib/cards.js` so it's testable without standing up
the server; repo gained its first test harness (`node:test`, zero new deps — `npm test`).
Landmine the tests caught: card ids. `chart.png`.slice(0, -'.html'.length) === `'char'` — the blind
extension-strip mangles image names, and stripping the extension at all would let `chart.png`
collide with `chart.html`. Images therefore keep their **full filename** as id; `.html` id
derivation is untouched so PROTOCOL §5.1 card→card links keep resolving.

| 4 | 2026-07-11 | Remove redundant top "duet" header bar (fake traffic-light dots + wordmark duplicate the native macOS title bar) | The app draws its own window chrome on top of native decorations → doubled close/min/fullscreen controls + wasted vertical space. | Delete the header element; native title bar keeps window controls + drag. Relocate any real controls it holds (theme toggle?) into the kept toolbar. | S | open |
| 5 | 2026-07-11 | Remove the legend/help bar (terminal=…/render=… + ⌘D hints) | Onboarding legend eats vertical space; the ⌘D hints are aspirational (keyboard splits are M1, not built yet). | Delete it. Keep the functional toolbar (session · reset layout · split ⊞/⊟ · seam hints). Maximize canvas area. | S | open |

## FB-2 — VERIFIED WORKING 2026-07-11: user dragged a real screenshot onto a pane and it loaded. Manual drag test passed.
