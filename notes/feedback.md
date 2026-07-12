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
| 6 | 2026-07-11 | Render **list** mode: right-click a card (image or HTML) → copy its on-disk path | List-mode cards expose no context menu, and a card's file location is surfaced nowhere in the UI — referencing it elsewhere means reconstructing `~/.duet/canvas/<session>/<file>` by hand. | Right-click handler on list items, in the **parent-app chrome** (NOT the sandboxed card iframe) → the clipboard is straightforward there, no `execCommand` gymnastics. Context menu → "Copy path" writes the card's location to the clipboard. The natural inverse of FB-2 (drag a path *in* ↔ copy a card's path *out*). Open Q: full file path `~/.duet/canvas/<session>/<filename>` vs. the containing directory — user said "location for the **directory** of that image", clarify on build. | S | **done** (`duet-canvas-canonical`) |

**FB-6 root cause + fix (2026-07-12).** Debugged with systematic-debugging. Root cause: FB-6 was **never implemented** — commit `16bfbe8` only captured it to this backlog; zero contextmenu/clipboard code existed. Two constraints shaped the fix: (1) a `sandbox="allow-scripts"` card iframe swallows `contextmenu`, so the parent can't intercept a right-click over the card body — and focus view has **no** parent-doc header at all (full-pane `.rp-frame`); (2) the browser page only knows the session id, not the absolute dir. **Fix:** reuse the existing `LINKER` postMessage bridge — inject a `CTX` script into every card iframe that forwards `contextmenu` (frame-local coords) up to the parent (`public/app.js`); the parent locates the card's pane via the unforgeable `ev.source===frame.contentWindow`, reads the trusted `dir` from `canvasConns[sid]`, and shows a `.pop` "⧉ copy folder path" menu at the cursor. Server now sends `dir: canvasDir` in the `/canvas` snapshot (`server.js`) — the client never trusts iframe-supplied paths. Works over the **whole card body in both list and focus views**. Copies the containing directory `~/.duet/canvas/<sid>`. Clipboard via `navigator.clipboard.writeText` (127.0.0.1 = secure context) with an `execCommand` fallback. Server half covered by `test/canvas-ws.test.js` ("snapshot advertises the absolute session directory"); DOM wiring is manual-verify (no jsdom harness). **Requires a dev-server restart (for `dir`) + app reload (for `app.js`) to take effect.**

## FB-2 — VERIFIED WORKING 2026-07-11: user dragged a real screenshot onto a pane and it loaded. Manual drag test passed.
| 7 | 2026-07-11 | (deferred) Float macOS traffic lights over content (overlay title bar) to reclaim the native title-bar strip | Native title bar still costs vertical space after FB-4/5. | Tauri `titleBarStyle: Overlay` + a drag region + CSS padding so the toolbar clears the floating lights. Deferred by user until after the demo. | M | deferred |
| 8 | 2026-07-12 | Window has no working reload affordance — ⌘R does nothing in the dev window | The Tauri window has no Reload menu item / keybinding, so a frontend change can't be seen without right-click→Reload or relaunch. | Add a native View menu with Reload (⌘R) — but ⌘R may want to stay free for the shell, so consider ⌘⇧R or a toolbar affordance. Workaround today: right-click app chrome → Reload. | S | open |
| 9 | 2026-07-12 | /html-template generates duet HTML into the vault INBOX, never $DUET_CANVAS — so "designing an html for duet" doesn't render in duet | (1) Routing: the vault's deliverables→INBOX rule wins; the "cp to $DUET_CANVAS in duet" guidance isn't followed, and the running session may not even have $DUET_CANVAS set. (2) Filename: even in $DUET_CANVAS the generated name ("2026-07-12 — Heros Quest … .html", spaces + em-dashes) fails CARD_FILE_RE and wouldn't mount. | This is exactly M2's `duet-canvas` skill: detect $DUET_CANVAS, instantiate the template directly into it under a card-safe `[A-Za-z0-9._-]+.html` name (reuse FB-2's `sanitizeCardName`). Interim: `cp` the INBOX file into `~/.duet/canvas/<session>/` with a clean name. | M | **done** (`duet-canvas` skill, vault) |

**FB-9 / duet-canvas stages 4–5 (2026-07-12).** The canonical-artifact feature is complete end to end.
Stages 1–3 (repo: `duet link`/`unlink`/`links`/`relink` + `$HOME` symlink guard + startup self-heal)
shipped earlier. Stages 4–5 (vault layer):
- **Stage 4** — new `duet-canvas` skill (`05 AI/CLAUDE CODE/skills/duet-canvas/SKILL.md`): generate
  (template-library-first via `/html-template`) → write the CANONICAL file to the managing project's
  folder (else INBOX) → `duet link` into `$DUET_CANVAS` → stamp the `duet_symlink` reverse-index
  marker (**HTML comment for `.html`, YAML frontmatter for `.md`**) → register a `## Canvas Artifacts`
  brief row. Added a Tier B row to `[[Frontmatter Schema]]` for `duet_session`/`duet_symlink`, and a
  `## Canvas Artifacts` section to the Duet brief. `~/bin/duet` symlinked onto PATH.
- **Stage 5** — `/inbox-clear` (step 1b), `/session-close` (2.8d verify-(c)), and `/meeting-agenda`
  (promote P4b) now run `duet relink --artifact <new-path>` after a verified move of a
  `duet_symlink`-tagged file (defensive binary resolution; no-op when absent; startup self-heal is the
  safety net). End-to-end mechanism proven (link→move→relink re-points, incl. spaced filenames).
- **Backfill** — the 15 pre-existing FB-9-migration symlinks were unmarked (would dangle silently on
  move); all 15 stamped with markers and verified. Live gap closed.
| 10 | 2026-07-12 | Right-click "copy path" copies the symlink's location, not the real file — and offer BOTH the file path and the folder path | Post-`duet-canvas-canonical`, most cards are **symlinks** into the vault; FB-6 copies the session `dir` (`~/.duet/canvas/<sid>`), i.e. where the *symlink* lives, so the user gets the view's location, not the canonical file. The copied value is also session-level, but the real target is **per-card** (each symlink -> a different vault file), so one `dir` can't express it. User confirmed both the file path and the folder path are useful. | Resolve server-side, per card: in `lib/cards.js` `buildCard`, when the card file is a symlink compute `fs.realpathSync(canvasDir/<file>)` (the `$HOME` guard already calls `realpathSync` -- the resolved path is in hand, just not sent) and attach it as `card.src`; a real card's `realpath` is just itself (still correct). Include `src` in the `snapshot` + `card` broadcasts (`server.js`). Client (`public/app.js` ctx menu): resolve the right-clicked frame -> card id -> `card.src`; show two items -- **copy file path** (`card.src`) and **copy folder path** (`dirname(card.src)`). File path is the more useful one (references the canonical artifact, mirroring FB-2's drag-in). Cover the symlink->realpath server half in `test/canvas-ws.test.js`; DOM wiring manual-verify. | S | **done** (`fb10-copy-vault-path`) |

**FB-10 fix (2026-07-12).** `lib/cards.js buildCard` now attaches `card.src` = the card's canonical
on-disk path: for a **symlinked** card that is `fs.realpathSync`'s resolved vault target (the realpath
was already computed for the `$HOME` guard — just captured now); for a **real** card it is its own
canvas-dir path; a **blocked** card carries none. `server.js` needed **no change** — the whole `card`
object already flows through both the `snapshot` and the per-file `card` broadcast. `public/app.js`
ctx handler resolves the right-clicked frame → its specific card (list view via the `.card` ancestor's
`data-card`; focus view via the render controller's new `shownCardId()`), reads `card.src`, and
`showCtxMenu` renders **two** rows — "⧉ copy file path" (`src`) and "⧉ copy folder path"
(`dirname(src)`); it falls back to the session dir when `src` is absent (old server / blocked card).
Tests: 3 unit (`test/cards.test.js` — symlink→vault target, real→own path, blocked→no src) + 1 WS
integration (`test/canvas-ws.test.js` — snapshot advertises resolved `src`). Suite 74/74.
