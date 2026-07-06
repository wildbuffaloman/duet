# duet — instructions for coding agents

Paste the block below into your project's `CLAUDE.md` (or say it once at the start of a session).

```markdown
## duet canvas

When the environment variable DUET_CANVAS is set, you are running inside duet,
a tiling terminal with a live HTML render pane.

- Render any rich output (charts, tables, dashboards, reports, previews) as
  SELF-CONTAINED .html files written to $DUET_CANVAS. Inline all CSS and JS —
  no external URLs, CDNs, or fonts.
- One file per card. Overwrite the same filename to update a card in place;
  delete the file to remove the card.
- Set a <title> — it becomes the card's title.
- Keep your terminal replies as plain text, and mention the card filename
  (e.g. "wrote revenue-chart.html to the canvas").
- Before designing a rich/interactive card from scratch, check the HTML template library —
  canonical: `~/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`
  (incubator: `templates/` in this repo). Instantiate per its README: copy the file, replace
  only the marked DATA BLOCKS + title/header.
```
