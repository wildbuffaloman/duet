# duet-canvas — canonical-artifact rendering (M2) — design

**Date:** 2026-07-12 · **Status:** design (awaiting review) · **Milestone:** M2 (`duet-canvas` skill)
**Supersedes the interim manual `cp`** used for FB-9. **Repo:** `~/dev/duet` · **Vault:** `~/Documents/Obsidian Vault`

## Problem

`/html-template` (and any generator) writes HTML/images into the **vault** (project folders / INBOX),
not into `$DUET_CANVAS`, so nothing renders in duet (FB-9). The naive fix — copy the file into the
canvas dir — creates **two sources of truth**: iterating in-canvas and editing in the vault drift
apart. We want the vault file to stay canonical and still render + hot-reload in duet, with **no
copies**.

## Principle

**The vault holds truth; `$DUET_CANVAS` holds symlinks (views), never content.** A canvas directory
becomes an *index of pointers*, not a store of files. Editing the canonical vault file updates the
duet card live. This preserves duet's "canvas is a directory" wedge — the directory is still just
files (symlinks are files) and any tool that can write one can render.

## Feasibility — PROVEN (2026-07-12, against the running server)

A test wrote a symlink `linked.html → /tmp/target.html` into a live session's canvas dir:

- **Read-through:** the symlinked file rendered as a card (server `statSync` follows the link; the
  watcher's dir-guard checks the symlink's *own* location, which is inside the canvas dir). ✓
- **Hot-reload:** editing the **target** in place fired chokidar through the symlink and the card
  updated. ✓
- The card **title** came from the target's `<title>`; the **card id** is the symlink's own basename.

So the render path needs **zero changes** to support symlinks. What we add is the *policy* layer
(where canonical files live, how they're linked, how links survive moves) plus a small security guard.

## Architecture — generate → render → iterate

```
generator (duet-canvas skill / /html-template) with $DUET_CANVAS set
  │ 1. instantiate template (template-library-first: canonical vault templates → plugin fallback)
  │ 2. write CANONICAL file → managing project's folder, else 00 HUB/00 INBOX   (real vault name; spaces ok)
  │ 3. `duet link` → card-safe symlink in $DUET_CANVAS:
  │        ~/.duet/canvas/<sid>/heros-quest.html  ──►  <vault>/…/Heros Quest … .html
  │ 4. register bidirectionally (see §Linkage)
  ▼
iterate: edit the canonical vault file → chokidar-through-symlink → card hot-reloads. No copy, no drift.
```

## Components (built in this order; the mechanism must exist before the skill can call it)

### 1. `duet link` — the linking primitive (`bin/duet`, pure filesystem)

- `duet link <vault-file> [--session <sid>] [--as <name>]`
  - Resolves the target session: `--session`, else `$DUET_SESSION`, else error.
  - Computes a **card-safe name**: `--as` if given, else `sanitizeCardName(basename(vault-file))`
    (reuse FB-2's `lib/cards.js sanitizeCardName` — spaces/em-dashes → `-`, keep extension).
  - Collision rule: if `~/.duet/canvas/<sid>/<name>` exists and points elsewhere, append `-2`, `-3`…;
    if it already points at this same file, no-op (idempotent).
  - Creates the symlink `~/.duet/canvas/<sid>/<name> → <abs vault-file>`.
  - Prints the resulting symlink path (callers capture it for frontmatter/brief).
- `duet unlink <name> [--session <sid>]` — remove the symlink only (never the canonical file).
- `duet links [--session <sid>]` — list symlinks + their targets + broken/ok status.
- `duet relink` — the reconcile/heal tool (see §Symlink integrity).

### 2. Server symlink hardening (`lib/cards.js`, TDD)

Read-through already works; add a **fail-closed target guard**:

- Before reading a card file, if it is a symlink, resolve `fs.realpathSync` and require the real path
  to be **under `$HOME`**. This admits the vault (`~/Documents/…`), `~/dev`, and home generally, and
  **blocks** links escaping to `/etc`, `/var`, or external mounts.
- A symlink whose target escapes `$HOME` renders a small inline **"blocked: link escapes home"** card
  (never the file contents), so a stray/hostile link is visible, not silently leaking.
- **Broken symlink** (target missing) already degrades gracefully: `statSync` throws → `buildCard`
  returns null → no card / `remove` broadcast. Keep that; `duet links` reports it as broken.

Rationale: duet is `127.0.0.1`-only and cards are user/agent-created locally, so this is
defense-in-depth, not a trust boundary — but the `$HOME` fence is cheap and principled.

### 3. Bidirectional linkage — how a project "knows its artifacts"

- **Artifact frontmatter** (stamped on the canonical vault file):
  ```yaml
  category: reference          # per [[Frontmatter Schema]]; artifact is a rendered deliverable
  project: "[[<Managing Project>]]"
  duet_session: <sid>
  duet_symlink: "~/.duet/canvas/<sid>/<name>.html"   # the STABLE canvas-side path
  ```
  `duet_symlink` is the **linchpin**: it is the reverse index that lets a broken link find its file.
- **Project brief** gains a `## Canvas Artifacts` section:
  ```markdown
  | Artifact | Canvas link | Updated |
  |----------|-------------|---------|
  | [[Heros Quest MVP Portal — UX Flow Map]] | `~/.duet/canvas/s3/heros-quest.html` | 2026-07-12 |
  ```
  Wikilinks keep it graph-native; the brief is the human-facing index of the project's live artifacts.

### 4. `duet-canvas` skill (the routing brain)

- **Trigger:** `$DUET_CANVAS` present in env (running inside a duet pane), or explicit invocation.
- **Generate flow:** instantiate (template-library-first) → write canonical to the managing project's
  folder (else INBOX) → `duet link` into `$DUET_CANVAS` → stamp artifact frontmatter → add/update the
  brief's `## Canvas Artifacts` row.
- **Managing-project resolution** (in order): explicit `--project` arg → else the project the
  generating session is already working in (a project brief in context / resolved from cwd) → else
  **none → INBOX** (and `/inbox-clear` later routes it to a project, carrying the symlink with it per
  §Symlink integrity). The artifact is never orphaned: INBOX is a valid managing "home" until routed.
- **Render conventions bundled:** self-contained, sandbox-safe (execCommand-copy, no external URLs),
  §5.1 card ids — the existing template-library rules.
- Composes with `/html-template`: the skill is where the "in duet → route to `$DUET_CANVAS`" decision
  lives, so `/html-template` stays general and delegates canvas-routing here.

## Symlink integrity under moves — the durability layer

Vault files move: `/inbox-clear` routes them out of INBOX, projects reorganize, the user drags files
in Obsidian. A symlink into the old path then dangles. The design keeps links correct two ways, both
riding the `duet_symlink` frontmatter:

**Invariant:** for every artifact whose frontmatter has `duet_symlink: P`, there exists a symlink at
`P` pointing to that artifact's **current** location — and nothing else writes `P`.

Because the symlink lives at a **stable canvas path** (`~/.duet/canvas/<sid>/<name>.html`) and points
*into* the mobile vault, a move only needs to **re-point the symlink's target** — the card's id,
name, and pane position never change, so the duet session is undisturbed.

### A. Proactive repair by movers (primary)

Any vault operation that **relocates** a file must, when that file's frontmatter carries
`duet_symlink`, re-point the symlink after the move:

- **`/inbox-clear`** (the named case): when routing a file out of INBOX, Step 0.5 already reads
  frontmatter — extend it to detect `duet_symlink`, and after the move run
  `duet relink --artifact <new-path>` (or directly: `ln -sf <new-path> <duet_symlink>`). It also moves
  the `## Canvas Artifacts` row to the destination project's brief and updates the artifact's
  `project:` frontmatter (routing already updates project frontmatter — this extends it).
- **`/session-close`** artifact routing, **`/meeting-agenda promote`**, and any future mover inherit
  the same rule. Factor it into a shared, tracked helper (`duet relink --artifact <path>`), so no
  mover reimplements the logic. Movers are the real-time correctness path.

### B. Reconcile / self-heal (safety net) — `duet relink`

For moves that bypass aware movers (manual `mv`, Obsidian drag, external tools):

- `duet relink` scans `~/.duet/canvas/*/` for **broken** symlinks. For each broken link at path `P`,
  it does a **reverse lookup**: grep the vault for a file whose frontmatter contains
  `duet_symlink: "P"`; if found at its new location, re-point `P → new-location`.
- It also scans artifacts (files carrying `duet_symlink`) and ensures the named symlink **exists** and
  points at the artifact — recreating a missing one.
- Reports: repaired, still-broken (no candidate found), and orphan symlinks (no artifact claims them).
- **When it runs:** on demand; and once at **duet server startup** (self-heal) — a cheap scan bounded
  by the number of canvas symlinks. Optionally surfaced in the UI as a "N links repaired" toast.
- `duet relink --artifact <path>` is the single-file form the movers call.

**Why the reverse lookup is reliable:** the symlink path is unique per artifact (it embeds the
session), and it is recorded verbatim in the artifact's frontmatter — so the mapping is 1:1 and
grep-recoverable even after an arbitrary move, as long as the frontmatter survives (which it does; a
move preserves file contents).

## Security

- Symlink target must resolve under `$HOME` (§Component 2), fail-closed.
- `duet link` only ever creates links; `duet unlink`/routing never delete the canonical vault file.
- `duet relink` only re-points/creates symlinks and never edits or moves vault content.

## Card id / naming

The card id is the symlink's card-safe basename (`heros-quest.html`), **stable across vault moves**
(only the target changes). The card **title** comes from the artifact's own `<title>`, independent of
the filename — so a spaced vault name still yields a clean card id and a rich title.

## Testing

| Level | Covers |
| --- | --- |
| Unit (TDD) | `duet link` naming/collision/idempotency; the `$HOME` symlink guard (blocked vs allowed realpath); broken-symlink → null |
| Unit (TDD) | `duet relink` reverse-lookup: broken link + artifact-with-frontmatter-elsewhere → repaired; missing symlink recreated; orphan reported |
| Integration | link → card broadcast → edit canonical → card hot-reloads (WS, real symlink in temp dirs) |
| Integration | move the canonical file, run `duet relink`, assert the card still resolves |
| Manual | generate a real artifact via the skill in a duet pane; then `/inbox-clear` it to a project and confirm the card survives |

## Build sequence (decomposition)

1. **Mechanism:** `duet link`/`unlink`/`links` + `sanitizeCardName` reuse + tests.
2. **Server guard:** `$HOME` symlink fence in `lib/cards.js` + tests.
3. **Reconcile:** `duet relink` (+ `--artifact`) + startup self-heal + tests.
4. **Skill:** `duet-canvas` skill — generate → canonical-vault → link → register (brief + frontmatter).
5. **Mover integration:** `/inbox-clear` (+ session-close/meeting-agenda) call `duet relink --artifact`
   on moving a `duet_symlink`-tagged file; move the brief's `## Canvas Artifacts` row on re-route.

**Two implementation plans** (each ships working software): stages **1–3** are repo-local
(`~/dev/duet`, TDD in `node:test`) → one plan. Stages **4–5** live in the vault skill layer
(`duet-canvas` skill + edits to `/inbox-clear` et al.) and depend on the `duet` CLI being on PATH →
a second plan, in the vault context. Build repo-side first; the CLI it produces is the contract the
skills consume.

**Deferred (separate sub-projects):** `duet-pack` plugin *packaging*; M3a event-bridge; the FB-2
drag-*in* case (external files aren't vault artifacts — decide copy vs link-to-origin later).

## Open questions

- `[[Frontmatter Schema]]` must gain `duet_session` / `duet_symlink` (and possibly a `duet-artifact`
  category or tag). Align before stamping at scale.
- Startup self-heal cost if a user accumulates hundreds of links — bound it / make it async.
- Atomic-rename saves (Obsidian) replace the target inode; `awaitWriteFinish` usually recovers, but
  verify hot-reload survives an Obsidian edit specifically (may need a re-stat on `change`).
