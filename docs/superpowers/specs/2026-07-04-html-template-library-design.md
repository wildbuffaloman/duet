# HTML Template Library — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm with Alberto, 2026-07-04)
**Seed:** duet `templates/` (founded earlier today: `system-map-critique.html` + README rules)

## Problem

Rich interactive HTML deliverables (architecture reviews, UI option choices, SOP reviews,
decision matrices, document critiques) get designed from scratch every time. duet founded a
template library with one template; this design grows it into an ecosystem-wide library any
Claude session can use — duet panes, /playground, /generate-html, AIAC sessions, Bufalinda work.

## Decisions (from brainstorm Q&A)

1. **Consumers:** ecosystem-wide — any Claude session, not just duet.
2. **Canonical home:** vault, `03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`
   (own subfolder; Obsidian sync distributes to both machines, no git needed).
3. **duet is the incubator:** templates born in duet work stabilize in `~/dev/duet/templates/`,
   then **graduate** — copied to the vault folder + README entry added there. The duet copy
   remains (duet docs reference it) but its README entry gains `canonical: vault/HTML TEMPLATES/`;
   post-graduation edits happen vault-side. Skills point **only** at the vault path.
4. **V1 catalog:** 5 templates — `system-map-critique` (graduates as-is), `ui-design-chooser`,
   `sop-map-critique`, `decision-matrix`, `doc-review`.
5. **Skill wiring:** new tiny router skill `html-template` + one-line pointers in
   `/generate-html`, `/iterate-html`, `/playground`, and duet's `examples/claude-instructions.md`.
6. **Internal architecture:** skeleton convention (approach C) — shared critique machinery in
   marked comment fences, no build step. Revisit generation only if the library grows large.

## Library structure (vault)

```
03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/
├── README.md                  ← library index: catalog table, rules, instantiation guide
├── _skeleton.html             ← critique-kit skeleton (new templates start here)
├── system-map-critique.html
├── ui-design-chooser.html
├── sop-map-critique.html
├── decision-matrix.html
└── doc-review.html
```

Versioning is lightweight (vault is not a git repo): each README catalog entry carries
`First used` / `Last updated` lines.

## Template anatomy

Founding rules 1–5 (from duet `templates/README.md`) carry over unchanged:
one file zero deps · sandbox-safe · data blocks at top · duet palette · the output is a prompt.

**Rule 6 — the critique kit.** Shared machinery (stance state, note fields, prompt compiler,
`execCommand`-first copy button, data-block validator) lives inside marked fences in every
template:

```html
<!-- CRITIQUE-KIT BEGIN (shared machinery — keep in sync across library, see _skeleton.html) -->
...
<!-- CRITIQUE-KIT END -->
```

`_skeleton.html` is a minimal *working* critique page (header + placeholder content + kit).
New template = copy skeleton, build the domain body, leave fences intact.
Kit fix = grep the fence across the library, apply the same edit. No build step.

**M3a forward-compat (hook slot, not a feature):** duet's roadmap (M3a, as of `a503bd8`) turns
the critique templates' "Copy feedback" into "Send to session" via `{__duet:"event"}` /
`data-duet-event`, superseding rule 5 *inside duet* when it ships. The kit therefore routes its
submit action through one function, `emitToSession(payload)`, which in v1 feature-detects the
duet event helper and always falls back to the prompt-compile box + copy button — the v1 output,
and the permanent standalone-tab behavior per Rule 7. When M3a's injected helper lands, enabling
"Send to session" is a single grep-propagated fence edit, no template redesign.

**Rule 7 — degrade gracefully outside duet.** duet niceties (e.g. `data-duet-card` card links)
are allowed but the template must stay fully functional as a lone browser tab or artifact —
duet-only affordances render inert, never broken.

**Instantiation contract** (unchanged): copy the file → replace only `<title>`, the header, and
the marked data blocks (`const`-style declarations right after `"use strict"`). Each block is
preceded by a comment documenting its shape with one example element. An agent never touches
layout or the kit.

## V1 catalog

| Template | Task shape | Data blocks |
| --- | --- | --- |
| `system-map-critique` | explain a system/plan/pipeline + harvest structured critique | `COMPONENTS`, `WIRES`, `FLOWS`, `PRIORITIES`/`PRESETS` |
| `ui-design-chooser` | choose between visual design options | `OPTIONS[{id, name, rationale, mockupHTML}]` |
| `sop-map-critique` | review an existing SOP **or design a new one** (blank stances = design mode) | `ROLES`, `STEPS[{id, role, name, desc, inputs, outputs, failure_modes}]`, `HANDOFFS` |
| `decision-matrix` | options × weighted criteria decision | `OPTIONS`, `CRITERIA[{name, weight, direction}]`, `SCORES` |
| `doc-review` | critique any document section-by-section (generic fallback) | `SECTIONS[{id, title, bodyHTML}]` |

Template-specific notes:

- **ui-design-chooser:** each `mockupHTML` is an inline fragment rendered scaled-down
  (CSS transform) in its own panel, click to zoom. Per-option stance (pick/reject/mixed) +
  element-level notes; compiles to "Option B, but with A's header…" feedback.
- **sop-map-critique:** swimlane layout (`ROLES` = lanes). Per-step keep/change/question.
  Design mode is the same file instantiated with a draft process and empty stances —
  critiquing a blank slate is designing. Compiles to SOP feedback or an SOP draft brief.
- **decision-matrix:** weight sliders re-rank live; a sensitivity hint marks criteria whose
  weight flips the winner. Compiles to a decision rationale paragraph.
- **doc-review:** progress indicator ("6/9 sections reviewed"); compiles to structured review
  feedback.

The README catalog table maps task-shape → template; the router skill quotes it.

## Skill wiring

- **`html-template` (new, tiny):** catalog table, vault path, instantiation contract,
  graduation ritual. Progressive-disclosure — short SKILL.md pointing at the library README
  for detail. Lives in the standard personal skill infrastructure (05 AI skills repo, synced
  to both machines), created via the normal skill-creation flow.
- **Pointers (one line each)** in `/generate-html`, `/iterate-html`, `/playground`, and duet's
  `examples/claude-instructions.md`:
  *"Before designing from scratch, check the HTML template library (`/html-template`) —
  instantiate a template if one fits the task shape."*
- **Repointing existing references when the vault home lands** (all currently name
  `~/dev/duet/templates/` as the library): the duet project brief's AI Context rule #1
  (`01 PROJECTS/Duet — Tiling Agent Terminal/Duet — Tiling Agent Terminal.md`), duet's
  `templates/README.md`, and the memory file
  `~/.claude/projects/-Users-albertoduhau/memory/project_duet_html_template_library.md` —
  all three point at the vault location, with duet described as the incubator.
  Vault edits beyond that brief: propose, don't auto-apply.

## Verification (per template)

1. Renders correctly in a duet card (sandboxed iframe, `allow-scripts` only) **and** a plain
   browser tab.
2. Copy button works under sandbox (`execCommand`-first, select-for-⌘C fallback).
3. One real instantiation dry-run — fill the data blocks for an actual case (e.g.
   `sop-map-critique` with a real Bufalinda SOP) and confirm only data blocks needed touching.

## Failure modes

- **Malformed data blocks** (the main risk): documented shape + example element per block, and
  the kit includes a small validator that renders a visible banner
  ("data block invalid: OPTIONS[2] missing `name`") instead of dying silently.
- **Clipboard:** `execCommand` fallback chain (established sandbox lesson).
- No network, no storage — nothing else to fail.

## Out of scope for v1

- Build/generation step (approach B) — revisit if the library grows large.
- M3a event plumbing (duet app-side work) — the kit ships only the `emitToSession` hook slot;
  the actual channel is duet's roadmap, not this library's.
- Template versioning beyond README dates.
- Bufalinda-brand-styled variants (`marca-bufalinda` can restyle instantiations later;
  the library stays duet-palette).
