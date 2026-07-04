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

## Instantiating (for agents)

```
cp templates/<template>.html <dest>.html   # e.g. $DUET_CANVAS/my-review.html
# edit ONLY: <title>, <h1>/header, and the marked data blocks at the top of the <script>
```

When asked for a rich interactive HTML deliverable, check this library first; if a new design is
general enough to reuse, add it here with a section in this README.
