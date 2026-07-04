# duet

**A tiling agent-terminal where text drives and canvas shows.** duet gives you Ghostty-style splits in the browser, but each pane is either a *real terminal* (a live PTY over binary WebSockets) or a *canvas* — a live render surface for HTML cards. Panes are linked by **session**: every terminal in a session gets a `$DUET_CANVAS` directory, and any process — your shell, a script, a coding agent — that writes a self-contained `.html` file into it sees that file appear as a live card in the session's canvas pane(s) in under 100ms. Overwrite the file and the card updates in place. Delete it and the card disappears. No SDK, no API, no ports to remember: **the canvas is a directory.**

## Quickstart

```sh
cd ~/dev/duet
npm start          # or: bin/duet
```

Open **http://127.0.0.1:7433**. Port busy? `DUET_PORT=7500 npm start`.

## The 60-second tour

1. **Split.** Hover a pane and click **⊞** (split right) or **⊟** (split down). Pick *terminal* or *canvas* for the new pane, and which session it joins.
2. **Flip.** Hover the seam between two panes — a **⇄ / ⇅** button appears. Click it to flip the split from side-by-side to stacked (and back).
3. **Resize.** Drag the seam. Terminals re-fit and send a resize to their PTY; canvas cards reflow.
4. **Toggle type.** Click the **▌ / ◪** control in a pane's header to switch it between terminal and canvas. Same session, different lens.
5. **Prove it's live.** In any terminal pane:

   ```sh
   echo '<title>hi</title><h1 style="font-family:sans-serif">hello, duet</h1>' > "$DUET_CANVAS/hi.html"
   ```

   The card mounts in the session's canvas pane before your finger leaves the Enter key.

## Use with Claude Code

Run `claude` inside any duet terminal pane — it inherits `$DUET_SESSION` and `$DUET_CANVAS` like every other process. Then teach it the one rule it needs: paste the snippet from [`examples/claude-instructions.md`](examples/claude-instructions.md) into your project's `CLAUDE.md` (or just say it once at the start of a session).

From then on, ask for anything visual — "chart last month's revenue", "show me the test-coverage table", "preview that landing page" — and instead of ASCII art you get a live card next to your terminal. The agent keeps its text replies plain and writes the rich version to `$DUET_CANVAS`. Overwriting the same filename turns any card into a live-updating dashboard.

## The demo

Inside a duet **terminal** pane (with a canvas pane visible for the same session):

```sh
sh examples/demo.sh
```

You'll watch three cards mount one by one — a note, an animated chart, a table — and then see the chart card update **in place** when the script overwrites it with an extra data series. That's the whole protocol, demonstrated in ~7 seconds of POSIX sh.

## Performance notes

Performance is duet's #1 requirement: zero perceived terminal latency, and file-write → pixels in under 100ms.

- **Binary WebSocket frames** carry raw PTY bytes both ways — no JSON, no base64, no per-keystroke encoding overhead. `permessage-deflate` is disabled and `TCP_NODELAY` is set on every connection, so keystrokes are never batched or held back.
- **WebGL renderer** (`@xterm/addon-webgl`) draws the terminal on the GPU, falling back silently to the canvas renderer where WebGL isn't available.
- **Native file watching** via chokidar (FSEvents on macOS) with a 40ms write-stabilization window — cards render as soon as the file stops growing, never from a half-written file.
- **Nothing logs on the data path.**

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE` / port 7433 busy | `DUET_PORT=7500 npm start` and open that port instead. |
| Terminal renders but feels off / GPU issues | The WebGL addon fails soft — duet automatically falls back to xterm.js's canvas renderer. No action needed. |
| `demo.sh` says "run me inside a duet terminal pane" | `$DUET_CANVAS` is only set in shells spawned *by duet*. Open a terminal pane in the browser and run it there. |
| Card doesn't appear | The file must match `*.html`, live directly in `$DUET_CANVAS` (no subdirectories), and be self-contained (a strict card sandbox means external URLs won't load anyway). |
| Nothing at http://127.0.0.1:7433 | duet binds `127.0.0.1` only, by design. It is a local tool; don't expose it. |

## Learn more

- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the full wire contract (v1): HTTP surface, both WebSocket endpoints, and the canvas-directory protocol.
- [`examples/`](examples/) — the demo script and the agent instructions snippet.
