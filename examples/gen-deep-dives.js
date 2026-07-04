// Generates deep-dive cards for each duet module into ~/.duet/canvas/s1/
const fs = require("fs"), path = require("path"), os = require("os");
const OUT = path.join(os.homedir(), ".duet", "canvas", "s1");

const SURFACE = { amber: "text surface", teal: "canvas surface", purple: "session link", neutral: "structure" };
const C = { amber: "#e8b862", teal: "#3fd3bf", purple: "#a78bfa", neutral: "#63708a" };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MODULES = [
  { id: "wm", color: "neutral", layer: "browser", name: "Tiling window manager", file: "public/app.js",
    role: "Every pane is a leaf in a binary split tree (BSP). Splitting replaces a leaf with a split node; closing collapses a node into its sibling; swapping trades two leaves' window ids. Everything — resize, flip, hide, restore — is an operation on that one tree.",
    decision: "Layout verbs live on the seam: the same divider resizes (drag) and flips orientation (hover ⇄/⇅). Panes stay clean; one object, two gestures.",
    guts: [
      "Split ratios clamp to 0.14–0.86 so a pane can never be dragged to zero.",
      "The tree persists to localStorage on every mutation; a corrupt snapshot fails validation (validNode) and falls back to the default layout instead of bricking the app.",
      "Hidden panes collapse out of the tree into a tray and re-split next to the focused pane on restore.",
      "During seam/grip drags a body class turns off pointer-events on all card iframes so embedded HTML can't swallow the drag." ],
    also: ["termpane", "renderpane", "session"] },
  { id: "termpane", color: "amber", layer: "browser", name: "Terminal pane", file: "public/app.js",
    role: "A real shell in the browser. xterm.js renders the grid; keystrokes leave as raw binary WebSocket frames (TextEncoder — never JSON or base64) and PTY output paints through the WebGL renderer, falling back to canvas if WebGL is unavailable.",
    decision: "Nothing on the data path but bytes — that's the whole zero-latency budget (<5ms local round trip).",
    guts: [
      "FitAddon + a ResizeObserver debounced through requestAnimationFrame collapse resize storms into single PTY resizes.",
      "A dead socket shows a click-to-restart overlay that opens a fresh /term connection (PTYs don't survive reloads by design).",
      "Terminal theme derives from the session color: the cursor is literally your session's hue.",
      "Scrollback 8000 lines; term.write feeds Uint8Array directly from the wire." ],
    also: ["termws", "session"] },
  { id: "renderpane", color: "teal", layer: "browser", name: "Render pane", file: "public/app.js",
    role: "A live view of its session's canvas. Focus view (default): one card owns the whole pane — the latest write, unless you pin one via ‹ › or the title menu. List view: every card stacked, auto-sized. Both render from one canonical mtime-sorted card array.",
    decision: "A render pane is a subscription, not a container — two render panes on one session mirror each other because state lives in the session.",
    guts: [
      "Cards render in sandboxed iframes (allow-scripts only, never allow-same-origin) — generated HTML can run JS but can't touch duet or your cookies.",
      "In list view an injected sizer script posts document height up (matched unforgeably by contentWindow), clamped 48–560px.",
      "While pinned, a new write shows a '● new' chip instead of yanking the screen; following latest resumes on click.",
      "Card→card links: clicks on data-duet-card / duet: hrefs post an open request up — which is how you got to this page." ],
    also: ["canvasws", "canvasdir"] },
  { id: "session", color: "purple", layer: "browser", name: "Session", file: "server.js + public/app.js",
    role: "The link. A session groups terminals and render panes around one canvas directory. The colored badge on every pane is its session; click it to reassign the pane. Focusing a pane lights up its whole session group.",
    decision: "Pane type (term/render) is carried by form; linkage is carried by color. You read the wiring of any screen at a glance.",
    guts: [
      "Session id doubles as the canvas directory name — validated server-side against ^[a-z0-9-]{1,32}$ before any filesystem touch.",
      "Every terminal in a session gets DUET_SESSION and DUET_CANVAS injected into its environment at PTY spawn.",
      "Session colors flow through one CSS custom property (--sc) + color-mix — every accent, cursor, and flash derives from it." ],
    also: ["canvasdir", "termws"] },
  { id: "termws", color: "amber", layer: "server", name: "/term bridge", file: "server.js",
    role: "One PTY per connection: spawns your login shell ($SHELL -l) via @lydell/node-pty with the session env injected. Client→server binary frames are written to the PTY; PTY output goes back as binary frames. Text frames carry only control JSON (resize, exit).",
    decision: "The server never parses terminal traffic — bytes in, bytes out.",
    guts: [
      "perMessageDeflate off and TCP_NODELAY on for every socket — compression and Nagle both add latency for nothing on localhost.",
      "High/low watermark flow control on ws.bufferedAmount pauses the PTY under output floods (yes, giant cat) and resumes when drained.",
      "WS close kills the PTY; PTY exit sends {type:'exit'} then closes the WS — no orphans in either direction.",
      "Guarded connection setup: a failing mkdir closes that socket (1011) instead of crashing the server." ],
    also: ["termpane", "security"] },
  { id: "canvasws", color: "teal", layer: "server", name: "/canvas feed", file: "server.js",
    role: "On connect: a full snapshot of the session's cards ({id, title, mtime, html} per *.html file, mtime ascending). Then a chokidar watcher (FSEvents-native on macOS) pushes every add / change / unlink as JSON over the open socket.",
    decision: "Snapshot-then-stream makes reconnects idempotent — a refresh never loses cards.",
    guts: [
      "Watchers are refcounted per session: first subscriber starts one, last one out closes it.",
      "awaitWriteFinish (40ms stability / 10ms poll) keeps half-written files from rendering as broken cards.",
      "Card title = <title> tag, else first <h1>, else the filename — extracted with a cheap regex, never a DOM parse.",
      "Budget: <100ms from file write to pixels in the pane." ],
    also: ["renderpane", "canvasdir"] },
  { id: "security", color: "neutral", layer: "server", name: "Security layer", file: "server.js",
    role: "A /term socket is a shell, so the WebSocket handshake is treated as a security boundary. Adversarial review caught the big one: without an Origin check, any website you visit could open ws://127.0.0.1:7433/term and drive your login shell — drive-by RCE.",
    decision: "Every hole here was found by trying to break the thing, not by checklist.",
    guts: [
      "Origin/Host allowlist on upgrade: only 127.0.0.1/localhost origins pass; browser pages elsewhere are rejected before any PTY exists.",
      "Server binds 127.0.0.1 only — never reachable from the network.",
      "Canvas reads allow only ^[A-Za-z0-9._-]+\\.html$ directly inside the session dir — no traversal, no symlink follows.",
      "Card iframes: sandbox=allow-scripts without allow-same-origin, so rendered HTML runs in an opaque origin." ],
    also: ["termws", "canvasws"] },
  { id: "canvasdir", color: "teal", layer: "disk", name: "Canvas directory", file: "~/.duet/canvas/<session>/",
    role: "THE protocol, and the reason duet needs no SDK: the canvas is a directory. Write a self-contained .html file → a card renders. Overwrite the same filename → the card updates in place. Delete it → gone. <title> names the card.",
    decision: "Any language, any tool, zero integration. This page reached your screen as: fs.writeFile → FSEvents → WebSocket push → iframe.",
    guts: [
      "Card id = filename without .html — which is also what card links (duet:<id> / data-duet-card) resolve against.",
      "Ordering is mtime ascending: the newest write is 'latest', which is what focus view follows.",
      "Overwrites keep card identity (same id), so in-place updates preserve position and don't re-animate.",
      "Works from inside duet ($DUET_CANVAS) and from outside (any process that knows the path — like the Claude chat that built this)." ],
    also: ["producers", "renderpane"] },
  { id: "producers", color: "purple", layer: "disk", name: "Producers", file: "examples/",
    role: "Whatever writes HTML: a shell one-liner (echo '<h1>hi</h1>' > $DUET_CANVAS/hi.html), claude running inside a pane (inherits the env var), a python script, a cron job — or an outside agent session writing the path directly.",
    decision: "No SDK means every tool you already have is already integrated.",
    guts: [
      "examples/claude-instructions.md is the one-paste snippet that teaches any coding agent the canvas convention.",
      "examples/demo.sh shows the whole protocol in 20 lines of POSIX sh: three cards, then an in-place update.",
      "The M3 back-channel (roadmap) will make this bidirectional: cards posting events a producer can read." ],
    also: ["canvasdir", "session"] },
];

const byId = {}; MODULES.forEach(m => byId[m.id] = m);

function page(m){
  const also = m.also.map(id =>
    `<a class="xl" data-duet-card="deep-${id}">◪ ${esc(byId[id].name)}</a>`).join("");
  const guts = m.guts.map(g => `<li>${esc(g)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>◪ ${esc(m.name)} — deep dive</title>
<style>
  :root{--bg:#0f1523;--panel:#121a29;--line:#1b2537;--line2:#243049;--ink:#c6d0de;--dim:#6f7d92;--faint:#45536a;
    --c:${C[m.color]};--amber:#e8b862;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:13.5px/1.6 var(--sans);padding:20px 22px 26px}
  .top{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .back{font:600 11.5px var(--mono);color:var(--dim);text-decoration:none;border:1px solid var(--line2);
    border-radius:8px;padding:5px 10px;cursor:pointer}
  .back:hover{color:var(--ink);border-color:var(--dim)}
  .chip{font:9.5px var(--mono);letter-spacing:.5px;color:var(--dim);border:1px solid var(--line2);
    border-radius:20px;padding:2px 9px}
  .chip.surface{color:var(--c);border-color:var(--c)}
  h1{margin:0 0 2px;font:700 20px var(--sans);border-left:4px solid var(--c);padding-left:12px}
  .file{font:11px var(--mono);color:var(--faint);margin:0 0 14px;padding-left:16px}
  p.role{max-width:64ch;margin:0 0 14px}
  .decision{border-left:3px solid var(--amber);background:rgba(232,184,98,.07);border-radius:0 8px 8px 0;
    padding:9px 12px;font-size:12.5px;margin:0 0 18px;max-width:64ch}
  .decision b{color:var(--amber);font:600 10px var(--mono);letter-spacing:.8px;display:block;margin-bottom:2px}
  h2{margin:0 0 8px;font:10.5px var(--mono);letter-spacing:1.1px;text-transform:uppercase;color:var(--dim)}
  ul{margin:0 0 18px;padding-left:18px;max-width:66ch}
  li{margin-bottom:7px}
  li::marker{color:var(--c)}
  .xl{display:inline-block;font:600 11.5px var(--mono);color:var(--c);border:1px solid var(--line2);
    border-radius:8px;padding:5px 10px;margin:0 6px 6px 0;cursor:pointer;text-decoration:none}
  .xl:hover{border-color:var(--c)}
</style></head>
<body>
  <div class="top">
    <a class="back" data-duet-card="05-architecture-playground">◂ back to the map</a>
    <span class="chip">${m.layer}</span><span class="chip surface">${SURFACE[m.color]}</span>
  </div>
  <h1>${esc(m.name)}</h1>
  <div class="file">${esc(m.file)}</div>
  <p class="role">${esc(m.role)}</p>
  <div class="decision"><b>DESIGN DECISION</b>${esc(m.decision)}</div>
  <h2>Under the hood</h2>
  <ul>${guts}</ul>
  <h2>See also</h2>
  <div>${also}</div>
</body></html>`;
}

for (const m of MODULES){
  fs.writeFileSync(path.join(OUT, `deep-${m.id}.html`), page(m));
  console.log("wrote deep-" + m.id + ".html");
}
