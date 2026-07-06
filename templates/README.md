# duet template library

Reusable, self-contained HTML templates for duet canvas cards (and any rich HTML deliverable).
Every template is a single file — inline CSS/JS, no external resources — so it renders anywhere:
a duet render pane, a browser tab, an artifact, an email attachment.

## Rules for templates in this library

1. **One file, zero dependencies.** No CDNs, no webfonts, no fetches. If it needs a chart, the chart is drawn inline (SVG/canvas/CSS).
2. **Sandbox-safe.** duet cards run in `sandbox="allow-scripts"` iframes: no same-origin, no `navigator.clipboard` guarantee. Copy buttons must use the `execCommand('copy')`-first pattern with a select-for-⌘C fallback (see `system-map-critique.html`).
3. **Data lives at the top of the script.** Each template declares its content as plain `const`-style data blocks (components, flows, options…) immediately after `"use strict"`. Instantiating a template = copy the file, replace the data blocks and the `<title>`/`<h1>`, touch nothing else.
4. **duet palette by default**: ground `#0a0e16`, panel `#0f1523`, ink `#c6d0de`, amber `#e8b862` (text surface), teal `#3fd3bf` (canvas surface), purple `#a78bfa` (session link). Semantic colors are separate (`--good`, warn, down). Templates are dark; they render on the canvas.
5. **The output is a prompt.** Interactive templates that collect input must compile it into natural language in a copyable box — the copy-paste prompt is the back-channel to the agent until M3 ships a real one.
6. **The critique kit.** Shared machinery (stance state, notes, prompt compiler, sandbox-safe
   copy, data-block validator) lives inside `<!-- CRITIQUE-KIT BEGIN -->` / `<!-- CRITIQUE-KIT END -->`
   fences in every template — identical across the library, sourced from `_skeleton.html`.
   Templates never modify the kit; a kit fix is applied to every fence by grep. The kit's
   submit path is `emitToSession(text)`: a feature-detect hook slot that returns `false` in v1
   (always fall back to the compiled-prompt box + copy button). When duet M3a ships its injected
   event helper, one fence edit flips "Copy feedback" to "Send to session" inside duet.
7. **Degrade gracefully outside duet.** duet niceties (`data-duet-card` links, the future M3a
   channel) are allowed but the template must stay fully functional as a lone browser tab or
   artifact — duet-only affordances render inert, never broken.

## Templates

### `system-map-critique.html`
Interactive system explainer + structured critique. Three-column component map with SVG wires,
playable animated data flows, per-component **keep / change / question** stances with notes,
priority voting with stance presets, and a live-compiled feedback prompt with copy button.

- **Data blocks to replace:** `COMPONENTS` (id/col/color/name/sub/role/decision), `WIRES`
  (from/to/color/dash/label), `FLOWS` (name/color/budget/desc/path), `PRIORITIES` + `PRESETS`,
  plus `<title>`, the `<h1>`, and the header legend.
- **Use for:** explaining an architecture/plan/pipeline and harvesting structured feedback on it.
- **First used:** 2026-07-04, duet's own architecture review.

### `ui-design-chooser.html`
Choose between rendered visual design options. Each option is a real, self-contained mockup
rendered scaled-down (click to zoom), with pick / reject / mixed stances and a note field; the
compiled output names the chosen option(s) and what to steal from the rest.

- **Data blocks to replace:** `OPTIONS` (id/name/rationale/mockupHTML — `mockupHTML` is an inline,
  self-contained fragment), plus `<title>`, the `<h1>`, and `.sub`.
- **Use for:** picking between visual design directions when seeing beats describing.
- **First used:** 2026-07-04, library v1.

### `sop-map-critique.html`
Swimlane map of a process — one lane per role, step cards showing inputs / outputs / ⚠ failure
modes, keep / change / question per step, and a handoff flow line. Works in two modes: reviewing
an existing SOP, or (all stances blank on a draft) running the design session itself.

- **Data blocks to replace:** `ROLES` (id/name), `STEPS`
  (id/role/name/desc/inputs/outputs/failure_modes), `HANDOFFS` (from/to), plus `<title>`/`<h1>`/`.sub`.
- **Use for:** designing or reviewing a standard operating procedure / multi-role process.
- **First used:** 2026-07-04, library v1.

### `decision-matrix.html`
Options × weighted criteria decision. Drag the criterion weights and the ranking re-sorts live;
a sensitivity hint flags which weights can flip the winner; a notes field captures constraints the
matrix can't hold. Compiled output is a decision rationale (winner, weights, sensitivity, notes).

- **Data blocks to replace:** `OPTIONS` (id/name), `CRITERIA` (id/name/weight/direction), `SCORES`
  (`{optionId: {criterionId: n}}`), plus `<title>`/`<h1>`/`.sub`.
- **Use for:** a defensible multi-criteria choice with visible sensitivity.
- **First used:** 2026-07-04, library v1.

### `doc-review.html`
Critique any document section by section — each section rendered with its body, keep / change /
question stance + note, and a live progress counter. The generic fallback when no sharper template
fits. Compiled output lists §-referenced findings and review progress.

- **Data blocks to replace:** `SECTIONS` (id/title/bodyHTML — `bodyHTML` is trusted inline markup),
  plus `<title>`/`<h1>`/`.sub`.
- **Use for:** structured review of a spec, proposal, brief, or any sectioned document.
- **First used:** 2026-07-04, library v1.

## Instantiating (for agents)

```
cp templates/<template>.html <dest>.html   # e.g. $DUET_CANVAS/my-review.html
# edit ONLY: <title>, <h1>/header, and the marked data blocks at the top of the <script>
```

When asked for a rich interactive HTML deliverable, check this library first; if a new design is
general enough to reuse, add it here with a section in this README.

## Linting

`node templates/lint-templates.js` — checks every template against rules 1–7
(title, strict mode, fences, data-block markers, hook slot, no external resources).
Run it before committing any template change.
