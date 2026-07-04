/* duet client — tiling window manager (ported from design/mockup.html) + real xterm.js PTY panes + live canvas render panes. */
(function(){
  "use strict";

  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var WS_BASE = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  var LS_KEY = "duet.layout.v1";
  var THEME_KEY = "duet.theme";
  var SID_RE = /^[a-z0-9-]{1,32}$/;

  /* ---------- tiny helpers ---------- */
  var esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };
  function el(tag, cls, html){ var e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }
  var cssEsc = (window.CSS && CSS.escape) ? CSS.escape.bind(CSS) : function(s){ return String(s).replace(/[^A-Za-z0-9._-]/g, ""); };
  var toastEl = document.getElementById("toast"), toastT;
  function toast(msg){ toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function(){ toastEl.classList.remove("show"); }, 1800); }
  function fmtTime(ms){ var d = new Date(ms || Date.now()); var p = function(n){ return (n < 10 ? "0" : "") + n; }; return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); }

  /* ---------- theme ---------- */
  var root = document.documentElement;
  try { var savedTheme = localStorage.getItem(THEME_KEY); if(savedTheme === "dark" || savedTheme === "light") root.setAttribute("data-theme", savedTheme); } catch(e){}
  document.getElementById("themeBtn").addEventListener("click", function(){
    var cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch(e){}
  });

  /* ---------- state (persisted) ---------- */
  var PALETTE = [
    { name:"teal",   base:"#3fd3bf" },
    { name:"violet", base:"#a78bfa" },
    { name:"amber",  base:"#e8b862" },
    { name:"rose",   base:"#f4849c" },
    { name:"sky",    base:"#5ec8f0" },
    { name:"green",  base:"#7fd08a" }
  ];
  var sessions = {};   // sid -> {id,name,base}         (sid doubles as the canvas dir name on the server)
  var windows  = {};   // winId -> {id,type:'term'|'render',session}
  var hidden   = [];   // window ids in the tray
  var tree = null, focused = null, winSeq = 0, sessSeq = 0, palIdx = 0;

  /* runtime only (never persisted) */
  var winEls = {};       // winId -> {root, badgeEl, nameEl, typeEl}
  var termCtls = {};     // winId -> terminal controller
  var renderCtls = {};   // winId -> render controller
  var canvasConns = {};  // sid -> shared /canvas connection (refcounted)
  var dragSrc = null;

  function makeSession(){
    var p = PALETTE[palIdx % PALETTE.length]; palIdx++;
    var id = "s" + (++sessSeq);
    if(!SID_RE.test(id)) throw new Error("bad session id");
    sessions[id] = { id:id, name:p.name, base:p.base };
    return sessions[id];
  }
  function makeWindow(type, sid){
    var id = "w" + (++winSeq);
    windows[id] = { id:id, type:type, session:sid };
    return windows[id];
  }
  function labelOf(w){ return "session " + w.session + " · " + (w.type === "term" ? "terminal" : "render"); }

  /* ---------- persistence ---------- */
  function persist(){
    try {
      var snap = {
        v:1, winSeq:winSeq, sessSeq:sessSeq, palIdx:palIdx,
        sessions:Object.keys(sessions).map(function(id){ var s = sessions[id]; return { id:s.id, name:s.name, base:s.base }; }),
        windows:Object.keys(windows).map(function(id){ var w = windows[id]; return { id:w.id, type:w.type, session:w.session }; }),
        hidden:hidden.slice(), tree:tree, focused:focused
      };
      localStorage.setItem(LS_KEY, JSON.stringify(snap));
    } catch(e){}
  }
  function validNode(n){
    if(!n || typeof n !== "object") return false;
    if(n.type === "leaf") return typeof n.winId === "string";
    if(n.type === "split") return (n.dir === "row" || n.dir === "col") && typeof n.ratio === "number" && n.ratio > 0.05 && n.ratio < 0.95 && validNode(n.a) && validNode(n.b);
    return false;
  }
  function loadPersisted(){
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch(e){}
    if(!raw) return false;
    try {
      var st = JSON.parse(raw);
      if(!st || st.v !== 1 || !validNode(st.tree)) return false;
      var sess = {}, wins = {};
      var COLOR_RE = /^#[0-9a-fA-F]{3,8}$/; // --sc / inline swatches interpolate this; only accept a hex color back from storage
      (st.sessions || []).forEach(function(s){
        if(s && typeof s.id === "string" && SID_RE.test(s.id) && typeof s.base === "string" && COLOR_RE.test(s.base)) sess[s.id] = { id:s.id, name:String(s.name || s.id), base:s.base };
      });
      (st.windows || []).forEach(function(w){
        if(w && typeof w.id === "string" && sess[w.session]) wins[w.id] = { id:w.id, type:w.type === "render" ? "render" : "term", session:w.session };
      });
      var leaves = visibleWinIds(st.tree), seen = {};
      for(var i = 0; i < leaves.length; i++){
        if(!wins[leaves[i]] || seen[leaves[i]]) return false; // dangling or duplicated leaf
        seen[leaves[i]] = true;
      }
      var hid = [];
      (st.hidden || []).forEach(function(id){ if(typeof id === "string" && wins[id] && !seen[id] && hid.indexOf(id) < 0) hid.push(id); });
      // drop windows referenced by neither the tree nor the tray
      Object.keys(wins).forEach(function(id){ if(!seen[id] && hid.indexOf(id) < 0) delete wins[id]; });
      if(!Object.keys(sess).length || !leaves.length) return false;
      sessions = sess; windows = wins; hidden = hid; tree = st.tree;
      winSeq = Math.max(0, st.winSeq|0); sessSeq = Math.max(0, st.sessSeq|0); palIdx = Math.max(0, st.palIdx|0);
      focused = (typeof st.focused === "string" && seen[st.focused]) ? st.focused : leaves[0];
      Object.keys(windows).forEach(function(id){ if(windows[id].type === "term") windows[id]._restoredNote = true; });
      return true;
    } catch(e){ return false; }
  }
  function seedDefault(){
    sessions = {}; windows = {}; hidden = []; winSeq = 0; sessSeq = 0; palIdx = 0;
    var s = makeSession();
    var t = makeWindow("term", s.id), r = makeWindow("render", s.id);
    tree = { type:"split", dir:"row", ratio:0.46, a:leaf(t.id), b:leaf(r.id) };
    focused = t.id;
  }

  /* ---------- BSP tree ops (ported from the mockup) ---------- */
  function leaf(winId){ return { type:"leaf", winId:winId }; }
  function findLeaf(node, winId, parent){
    if(node.type === "leaf") return node.winId === winId ? { node:node, parent:parent } : null;
    return findLeaf(node.a, winId, node) || findLeaf(node.b, winId, node);
  }
  function replaceChild(parent, oldN, newN){
    if(!parent){ tree = newN; return; }
    if(parent.a === oldN) parent.a = newN; else parent.b = newN;
  }
  function splitLeaf(targetWinId, dir, newWinId){
    var f = findLeaf(tree, targetWinId, null); if(!f) return;
    var newN = { type:"split", dir:dir, ratio:0.5, a:f.node, b:leaf(newWinId) };
    replaceChild(f.parent, f.node, newN);
  }
  function collapse(winId){
    var f = findLeaf(tree, winId, null); if(!f) return false;
    if(!f.parent) return false; // last window
    var sib = f.parent.a === f.node ? f.parent.b : f.parent.a;
    var gp = findParentOf(tree, f.parent, null);
    replaceChild(gp, f.parent, sib);
    return true;
  }
  function findParentOf(node, target, parent){
    if(node === target) return parent;
    if(node.type === "leaf") return null;
    return findParentOf(node.a, target, node) || findParentOf(node.b, target, node);
  }
  function visibleWinIds(node, out){ out = out || []; if(node.type === "leaf") out.push(node.winId); else { visibleWinIds(node.a, out); visibleWinIds(node.b, out); } return out; }

  /* ---------- structural actions ---------- */
  function doSplit(targetWinId, dir, type, sid){
    if(!sessions[sid]) return;
    var w = makeWindow(type, sid);
    splitLeaf(targetWinId, dir, w.id);
    focused = w.id; rebuild();
    toast("＋ " + labelOf(w) + "  ·  split " + (dir === "row" ? "right" : "down"));
  }
  function doClose(winId){
    if(visibleWinIds(tree).length <= 1){ toast("can't close the last window"); return; }
    if(collapse(winId)){
      destroyWin(winId); delete windows[winId];
      if(focused === winId) focused = visibleWinIds(tree)[0];
      rebuild();
    }
  }
  function doHide(winId){
    if(visibleWinIds(tree).length <= 1){ toast("can't hide the last window"); return; }
    if(collapse(winId)){
      hidden.push(winId);
      if(focused === winId) focused = visibleWinIds(tree)[0];
      rebuild(); // element (and its live shell) stays alive in winEls, just detached
      var w = windows[winId];
      toast("hid " + labelOf(w) + (w.type === "term" ? " — shell keeps running" : ""));
    }
  }
  function doRestore(winId){
    var i = hidden.indexOf(winId); if(i < 0) return;
    hidden.splice(i, 1);
    splitLeaf(focused || visibleWinIds(tree)[0], "row", winId);
    focused = winId; rebuild();
    toast("restored " + labelOf(windows[winId]));
  }
  function doSwap(aId, bId){
    if(aId === bId) return;
    var fa = findLeaf(tree, aId, null), fb = findLeaf(tree, bId, null);
    if(!fa || !fb) return;
    fa.node.winId = bId; fb.node.winId = aId;
    rebuild(); toast("swapped panes");
  }
  function toggleType(winId){
    var w = windows[winId];
    var wasTerm = w.type === "term";
    destroyWin(winId);
    w.type = wasTerm ? "render" : "term";
    focused = winId; rebuild();
    toast("this pane → " + (w.type === "term" ? "terminal (fresh shell)" : "render" + (wasTerm ? " (shell closed)" : "")));
  }
  function reassignSession(winId){
    var w = windows[winId];
    var ids = Object.keys(sessions);
    if(ids.length < 2){ toast("only one session — use ＋ session to add another"); return; }
    var old = w.session;
    w.session = ids[(ids.indexOf(w.session) + 1) % ids.length];
    if(w.type === "render"){
      destroyWin(winId); // recreate → resubscribes to the new session's canvas
      rebuild();
    } else {
      refreshWinChrome(winId);
      var c = termCtls[winId];
      if(c){
        c.setSessionColor(sessions[w.session].base);
        c.note("[pane → session " + w.session + " — this shell still has DUET_SESSION=" + old + "; exit or restart it to inherit the new session]");
      }
      markFocus(); updateChrome(); persist();
    }
    toast(labelOf(w) + " → session " + w.session + " (" + sessions[w.session].name + ")");
  }
  function destroyWin(winId){
    var t = termCtls[winId];   if(t){ t.dispose(); delete termCtls[winId]; }
    var r = renderCtls[winId]; if(r){ r.dispose(); delete renderCtls[winId]; }
    var rec = winEls[winId];
    if(rec){ if(rec.root.parentNode) rec.root.parentNode.removeChild(rec.root); delete winEls[winId]; }
  }
  function resetLayout(){
    Object.keys(winEls).forEach(function(id){ destroyWin(id); });
    Object.keys(canvasConns).forEach(function(sid){ // defensive: refcounts should already be zero
      var c = canvasConns[sid]; c.dead = true;
      if(c.timer){ clearTimeout(c.timer); }
      if(c.ws){ try{ c.ws.close(); }catch(e){} }
      delete canvasConns[sid];
    });
    try { localStorage.removeItem(LS_KEY); } catch(e){}
    seedDefault(); rebuild();
    toast("layout reset — fresh session s" + sessSeq);
  }

  /* ---------- render the tree ---------- */
  var workspace = document.getElementById("workspace");
  function rebuild(){
    workspace.innerHTML = "";
    var rootEl = renderNode(tree); rootEl.style.flex = "1";
    workspace.appendChild(rootEl);
    updateChrome(); markFocus(); persist();
    Object.keys(termCtls).forEach(function(id){ termCtls[id].fitSoon(); });
    var fc = termCtls[focused]; if(fc) fc.focus();
  }
  function renderNode(node){
    if(node.type === "leaf") return ensureWinEl(node.winId);
    var wrap = el("div", "split " + (node.dir === "row" ? "row" : "col"));
    var aEl = renderNode(node.a), bEl = renderNode(node.b);
    aEl.style.flex = node.ratio + " 1 0"; bEl.style.flex = (1 - node.ratio) + " 1 0";
    var div = el("div", "divider " + (node.dir === "row" ? "v" : "h"));
    attachResize(div, node, wrap, aEl, bEl);
    var flip = el("button", "flip", node.dir === "row" ? "⇄" : "⇅");
    flip.title = "flip this split — " + (node.dir === "row" ? "stack it (horizontal)" : "side by side (vertical)");
    flip.setAttribute("aria-label", "flip split orientation");
    flip.addEventListener("pointerdown", function(e){ e.stopPropagation(); }); // don't start a resize
    flip.addEventListener("click", function(e){ e.stopPropagation(); node.dir = node.dir === "row" ? "col" : "row"; rebuild(); toast("split → " + (node.dir === "row" ? "side by side" : "stacked")); });
    div.appendChild(flip);
    wrap.append(aEl, div, bEl);
    return wrap;
  }
  function attachResize(div, node, wrap, aEl, bEl){
    div.addEventListener("pointerdown", function(e){
      e.preventDefault(); div.setPointerCapture(e.pointerId);
      wrap.classList.add("resizing");
      document.body.classList.add("seam-drag"); // iframes stop eating pointer events
      function move(ev){
        var r = wrap.getBoundingClientRect();
        var ratio = node.dir === "row" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        ratio = Math.max(0.14, Math.min(0.86, ratio)); node.ratio = ratio;
        aEl.style.flex = ratio + " 1 0"; bEl.style.flex = (1 - ratio) + " 1 0";
      }
      function up(){
        wrap.classList.remove("resizing");
        document.body.classList.remove("seam-drag");
        div.removeEventListener("pointermove", move); div.removeEventListener("pointerup", up); div.removeEventListener("lostpointercapture", up);
        persist();
        Object.keys(termCtls).forEach(function(id){ termCtls[id].fitSoon(); });
      }
      div.addEventListener("pointermove", move); div.addEventListener("pointerup", up); div.addEventListener("lostpointercapture", up);
    });
  }

  /* ---------- window element ---------- */
  function ensureWinEl(winId){
    var rec = winEls[winId];
    if(!rec){ rec = createWinEl(windows[winId]); winEls[winId] = rec; }
    return rec.root;
  }
  function createWinEl(w){
    var s = sessions[w.session];
    var win = el("div", "window");
    win.dataset.win = w.id; win.dataset.type = w.type; win.dataset.session = w.session;
    win.style.setProperty("--sc", s.base);
    win.addEventListener("pointerdown", function(e){
      var focusTerm = !e.target.closest("button");
      setFocus(w.id, focusTerm);
    });

    // header
    var head = el("div", "win-head");
    var grip = el("div", "grip");
    grip.setAttribute("draggable", "true");
    grip.title = "drag onto another pane to swap";
    var badge = el("button", "sbadge", esc(w.session));
    badge.title = "reassign session"; badge.setAttribute("aria-label", "reassign session");
    badge.addEventListener("click", function(e){ e.stopPropagation(); reassignSession(w.id); });
    var typ = el("span", "wtype", w.type === "term" ? "▌ term" : "◪ render");
    typ.title = "switch this pane between terminal / render";
    typ.addEventListener("click", function(e){ e.stopPropagation(); toggleType(w.id); });
    var nm = el("span", "wname", esc(s.name));
    grip.append(badge, typ, nm);
    grip.addEventListener("dragstart", function(e){
      dragSrc = w.id;
      document.body.classList.add("grip-drag");
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", w.id);
    });
    grip.addEventListener("dragend", function(){ dragSrc = null; document.body.classList.remove("grip-drag"); });

    var ctl = el("div", "win-ctl");
    ctl.append(
      ctlBtn("⊞", "split right", function(e){ openSplitMenu(w.id, "row", e.currentTarget); }),
      ctlBtn("⊟", "split down",  function(e){ openSplitMenu(w.id, "col", e.currentTarget); }),
      ctlBtn("▁", "hide",        function(){ doHide(w.id); }),
      ctlBtn("✕", "close",       function(){ doClose(w.id); })
    );
    head.append(grip, ctl);
    win.appendChild(head);

    // body
    win.appendChild(w.type === "term" ? createTermBody(w) : createRenderBody(w));

    // drag-swap drop target
    win.addEventListener("dragover", function(e){ if(dragSrc && dragSrc !== w.id){ e.preventDefault(); win.classList.add("drop-target"); } });
    win.addEventListener("dragleave", function(){ win.classList.remove("drop-target"); });
    win.addEventListener("drop", function(e){ e.preventDefault(); win.classList.remove("drop-target"); if(dragSrc){ doSwap(dragSrc, w.id); dragSrc = null; document.body.classList.remove("grip-drag"); } });

    return { root:win, badgeEl:badge, nameEl:nm, typeEl:typ };
  }
  function refreshWinChrome(winId){
    var rec = winEls[winId], w = windows[winId];
    if(!rec || !w) return;
    var s = sessions[w.session];
    rec.root.dataset.session = w.session;
    rec.root.style.setProperty("--sc", s.base);
    rec.badgeEl.textContent = w.session;
    rec.nameEl.textContent = s.name;
  }
  function ctlBtn(glyph, title, fn){
    var b = el("button", null, glyph);
    b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", function(e){ e.stopPropagation(); fn(e); });
    return b;
  }
  function setFocus(id, focusTerm){
    if(focused !== id){ focused = id; markFocus(); persist(); }
    if(focusTerm){ var c = termCtls[id]; if(c) c.focus(); }
  }
  function markFocus(){
    var fw = windows[focused];
    Object.keys(winEls).forEach(function(id){
      var elm = winEls[id].root;
      elm.classList.toggle("focused", id === focused);
      elm.classList.toggle("linked", !!(fw && id !== focused && windows[id] && windows[id].session === fw.session));
    });
    updateChrome();
  }

  /* ---------- terminal pane (real xterm.js over /term) ---------- */
  function termTheme(base){
    return {
      background:"#0a0e16", foreground:"#c6d0de",
      cursor:base, cursorAccent:"#0a0e16",
      selectionBackground:"#28354d",
      black:"#0f1523",    red:"#e07a6a",      green:"#59c07f",     yellow:"#e0a94b",
      blue:"#5ec8f0",     magenta:"#a78bfa",  cyan:"#3fd3bf",      white:"#c6d0de",
      brightBlack:"#45536a", brightRed:"#f0938a", brightGreen:"#7fd9a0", brightYellow:"#eec27e",
      brightBlue:"#8ad8f8",  brightMagenta:"#c4aefc", brightCyan:"#6fe3d2", brightWhite:"#e7edf6"
    };
  }
  function createTermBody(w){
    var body = el("div", "term-body");
    var host = el("div", "xterm-host");
    var overlay = el("div", "term-overlay", '<span class="msg"></span>');
    body.append(host, overlay);

    var term = new window.Terminal({
      cursorBlink:true,
      fontSize:13,
      fontFamily:'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      lineHeight:1.15,
      scrollback:8000,
      allowProposedApi:true,
      theme:termTheme(sessions[w.session].base)
    });
    var fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      var gl = new window.WebglAddon.WebglAddon();
      gl.onContextLoss(function(){ try { gl.dispose(); } catch(e){} }); // silent fallback to the default renderer
      term.loadAddon(gl);
    } catch(e){ /* canvas/DOM renderer fallback */ }

    // let ⌘D / ctrl+shift+D bubble up as split shortcuts (plain ctrl+D stays EOF for the shell)
    term.attachCustomKeyEventHandler(function(e){
      if(e.type === "keydown" && (e.key === "d" || e.key === "D") && (e.metaKey || (e.ctrlKey && e.shiftKey))) return false;
      return true;
    });

    var enc = new TextEncoder();
    var ws = null, closedByUs = false, exited = false, started = false, disposed = false;
    var lastCols = 0, lastRows = 0, raf = 0;

    term.onData(function(s){ if(ws && ws.readyState === 1) ws.send(enc.encode(s)); });
    term.onBinary(function(s){
      if(!(ws && ws.readyState === 1)) return;
      var b = new Uint8Array(s.length);
      for(var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
      ws.send(b);
    });

    function doFit(){
      if(disposed || !body.isConnected) return;
      try { fit.fit(); } catch(e){ return; }
      if(term.cols !== lastCols || term.rows !== lastRows){
        lastCols = term.cols; lastRows = term.rows;
        if(ws && ws.readyState === 1) ws.send(JSON.stringify({ type:"resize", cols:term.cols, rows:term.rows }));
      }
    }
    function fitSoon(){ if(raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(function(){ raf = 0; doFit(); }); }

    function showOverlay(msg){ overlay.querySelector(".msg").textContent = msg; overlay.classList.add("show"); }
    function connect(){
      closedByUs = false; exited = false;
      overlay.classList.remove("show");
      try { fit.fit(); } catch(e){}
      lastCols = term.cols; lastRows = term.rows;
      var sock = new WebSocket(WS_BASE + "/term?pane=" + encodeURIComponent(w.id) + "&session=" + encodeURIComponent(w.session) + "&cols=" + term.cols + "&rows=" + term.rows);
      sock.binaryType = "arraybuffer";
      ws = sock;
      sock.onmessage = function(ev){
        if(typeof ev.data === "string"){
          var m = null; try { m = JSON.parse(ev.data); } catch(e){}
          if(m && m.type === "exit"){ exited = true; showOverlay("[shell exited" + (m.code != null ? " · code " + m.code : "") + " — click to restart]"); }
          return;
        }
        term.write(new Uint8Array(ev.data)); // binary PTY bytes straight into xterm
      };
      sock.onclose = function(){
        if(ws !== sock) return;
        ws = null;
        if(!closedByUs && !disposed && !exited) showOverlay("[session ended — click to restart]");
      };
      sock.onerror = function(){};
    }
    overlay.addEventListener("click", function(e){
      e.stopPropagation();
      term.write("\r\n\x1b[2m[restarting — fresh shell in session " + w.session + "]\x1b[0m\r\n");
      connect();
      setFocus(w.id, true);
    });

    var ro = new ResizeObserver(function(){
      if(disposed || !body.isConnected) return;
      if(!started){
        var r = host.getBoundingClientRect();
        if(r.width < 20 || r.height < 20) return; // wait until the pane really has pixels
        started = true;
        if(w._restoredNote){ term.write("\x1b[2m[layout restored — fresh shell: PTYs don't survive a reload]\x1b[0m\r\n"); delete w._restoredNote; }
        connect();
        if(focused === w.id) term.focus();
        return;
      }
      fitSoon();
    });
    ro.observe(body);

    termCtls[w.id] = {
      focus:function(){ try { term.focus(); } catch(e){} },
      fitSoon:fitSoon,
      setSessionColor:function(base){ try { term.options.theme = termTheme(base); } catch(e){} },
      note:function(msg){ term.write("\r\n\x1b[2m" + msg + "\x1b[0m\r\n"); },
      dispose:function(){
        disposed = true; closedByUs = true;
        try { ro.disconnect(); } catch(e){}
        if(raf) cancelAnimationFrame(raf);
        if(ws){ var s2 = ws; ws = null; try { s2.onclose = null; s2.close(); } catch(e){} }
        try { term.dispose(); } catch(e){}
      }
    };
    return body;
  }

  /* ---------- canvas connections (one shared ws per session, refcounted) ---------- */
  function acquireCanvas(sid, sub){
    var c = canvasConns[sid];
    if(!c){
      c = canvasConns[sid] = { sid:sid, subs:[], ws:null, timer:0, cards:{}, order:[], gotSnapshot:false, dead:false };
      connectCanvas(c);
    }
    if(c.subs.indexOf(sub) < 0) c.subs.push(sub);
    if(c.gotSnapshot) sub.snapshot(c.order.map(function(id){ return c.cards[id]; }));
  }
  function releaseCanvas(sid, sub){
    var c = canvasConns[sid]; if(!c) return;
    var i = c.subs.indexOf(sub); if(i >= 0) c.subs.splice(i, 1);
    if(!c.subs.length){
      c.dead = true;
      if(c.timer){ clearTimeout(c.timer); c.timer = 0; }
      if(c.ws){ try { c.ws.close(); } catch(e){} }
      delete canvasConns[sid];
    }
  }
  function connectCanvas(c){
    var sock = new WebSocket(WS_BASE + "/canvas?session=" + encodeURIComponent(c.sid));
    c.ws = sock;
    sock.onmessage = function(ev){
      if(typeof ev.data !== "string") return;
      var m = null; try { m = JSON.parse(ev.data); } catch(e){ return; }
      if(m.type === "snapshot"){
        c.cards = {}; c.order = [];
        (m.cards || []).forEach(function(cd){ if(cd && cd.id != null){ c.cards[cd.id] = cd; c.order.push(cd.id); } });
        c.gotSnapshot = true;
        var list = c.order.map(function(id){ return c.cards[id]; });
        c.subs.forEach(function(s){ s.snapshot(list); });
      } else if(m.type === "card" && m.card && m.card.id != null){
        var isNew = !(m.card.id in c.cards);
        c.cards[m.card.id] = m.card;
        if(isNew) c.order.push(m.card.id);
        c.subs.forEach(function(s){ s.card(m.card, isNew); });
      } else if(m.type === "remove" && m.id != null){
        if(m.id in c.cards){
          delete c.cards[m.id];
          c.order = c.order.filter(function(id){ return id !== m.id; });
          c.subs.forEach(function(s){ s.remove(m.id); });
        }
      }
    };
    sock.onclose = function(){
      if(c.ws === sock) c.ws = null;
      if(c.dead) return;
      c.timer = setTimeout(function(){ c.timer = 0; if(!c.dead) connectCanvas(c); }, 1000); // snapshot on reconnect makes this idempotent
    };
    sock.onerror = function(){};
  }

  /* ---------- render pane (cards from the session canvas) ---------- */
  // Cards auto-size: a tiny injected script posts the document height up; we match by contentWindow (unforgeable across frames).
  var SIZER = '<script>(function(){var p=function(){try{parent.postMessage({__duet:"h",h:document.documentElement.scrollHeight},"*")}catch(e){}};try{new ResizeObserver(p).observe(document.documentElement)}catch(e){}addEventListener("load",p);setTimeout(p,30);})();</' + 'script>';
  window.addEventListener("message", function(ev){
    var d = ev.data;
    if(!d || d.__duet !== "h" || typeof d.h !== "number") return;
    var frames = document.querySelectorAll(".card-frame");
    for(var i = 0; i < frames.length; i++){
      if(frames[i].contentWindow === ev.source){
        frames[i].style.height = Math.max(48, Math.min(560, Math.ceil(d.h))) + "px";
        break;
      }
    }
  });
  function buildCardEl(cd){
    var art = el("article", "card"); art.dataset.card = cd.id;
    var head = el("div", "card-head");
    head.appendChild(el("span", "card-id", "◪ " + esc(cd.id)));
    head.appendChild(el("span", "card-title", esc(cd.title || cd.id)));
    head.appendChild(el("span", "badge", esc(fmtTime(cd.mtime))));
    art.appendChild(head);
    var body = el("div", "card-body");
    var frame = document.createElement("iframe");
    frame.className = "card-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = (cd.html || "") + SIZER;
    body.appendChild(frame);
    art.appendChild(body);
    return art;
  }
  function flash(c){ c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); setTimeout(function(){ c.classList.remove("flash"); }, 900); }
  function createRenderBody(w){
    var scroll = el("div", "canvas-scroll");
    scroll.dataset.rw = w.id; scroll.dataset.sid = w.session;
    function emptyState(){
      return el("div", "empty",
        '<div class="big">◪</div>' +
        '<div>session ' + esc(w.session) + ' canvas is empty —<br>write HTML to <code>$DUET_CANVAS</code> in a linked terminal.</div>' +
        '<div><code>echo "&lt;h1&gt;hola&lt;/h1&gt;" &gt; $DUET_CANVAS/hola.html</code></div>');
    }
    scroll.appendChild(emptyState());
    function cardIn(id){ return scroll.querySelector('.card[data-card="' + cssEsc(String(id)) + '"]'); }
    var sub = {
      snapshot:function(cards){
        // skip the re-render if nothing changed (reconnect snapshots are usually identical)
        var have = scroll.querySelectorAll(".card");
        if(have.length === cards.length){
          var same = true;
          for(var i = 0; i < cards.length; i++){
            if(have[i].dataset.card !== String(cards[i].id) || have[i].dataset.mtime !== String(cards[i].mtime)){ same = false; break; }
          }
          if(same) return;
        }
        var st = scroll.scrollTop;
        scroll.innerHTML = "";
        if(!cards.length){ scroll.appendChild(emptyState()); return; }
        cards.forEach(function(cd){
          var c = buildCardEl(cd); c.dataset.mtime = String(cd.mtime); c.style.animation = "none";
          scroll.appendChild(c);
        });
        scroll.scrollTop = st;
      },
      card:function(cd, isNew){
        var em = scroll.querySelector(".empty"); if(em) em.remove();
        var fresh = buildCardEl(cd); fresh.dataset.mtime = String(cd.mtime);
        var old = cardIn(cd.id);
        if(old){
          var st = scroll.scrollTop;
          fresh.style.animation = "none";
          old.replaceWith(fresh);
          scroll.scrollTop = st; // keep the reader where they were
        } else {
          scroll.appendChild(fresh);
          fresh.scrollIntoView({ behavior:reduce ? "auto" : "smooth", block:"nearest" });
        }
        flash(fresh);
      },
      remove:function(id){
        var old = cardIn(id); if(old) old.remove();
        if(!scroll.querySelector(".card")) scroll.appendChild(emptyState());
      }
    };
    acquireCanvas(w.session, sub);
    renderCtls[w.id] = { dispose:function(){ releaseCanvas(w.session, sub); } };
    return scroll;
  }

  /* ---------- split menu popover ---------- */
  var openPop = null;
  function closePop(){ if(openPop){ openPop.remove(); openPop = null; document.removeEventListener("pointerdown", onDocDown, true); } }
  function onDocDown(e){ if(openPop && !openPop.contains(e.target)) closePop(); }
  function openSplitMenu(winId, dir, anchor){
    closePop();
    var pop = el("div", "pop");
    pop.innerHTML = '<div class="ph">split ' + (dir === "row" ? "right" : "down") + ' — new pane</div>';
    Object.keys(sessions).forEach(function(sid){
      var s = sessions[sid];
      var row = el("div", "prow");
      row.innerHTML = '<span class="nm"><span class="sd" style="background:' + s.base + '"></span>' + esc(sid) + ' · ' + esc(s.name) + '</span>';
      var t = el("button", "mk", "▌"); t.title = "terminal in " + sid;
      t.addEventListener("click", function(e){ e.stopPropagation(); closePop(); doSplit(winId, dir, "term", sid); });
      var r = el("button", "mk", "◪"); r.title = "render in " + sid;
      r.addEventListener("click", function(e){ e.stopPropagation(); closePop(); doSplit(winId, dir, "render", sid); });
      row.append(t, r); pop.appendChild(row);
    });
    var nrow = el("div", "prow");
    nrow.style.borderTop = "1px solid var(--card-line)"; nrow.style.marginTop = "4px"; nrow.style.paddingTop = "6px";
    nrow.innerHTML = '<span class="nm" style="color:var(--card-faint)">＋ new session</span>';
    var nt = el("button", "mk", "▌"); nt.title = "new session · terminal";
    nt.addEventListener("click", function(e){ e.stopPropagation(); closePop(); var s = makeSession(); doSplit(winId, dir, "term", s.id); });
    var nr = el("button", "mk", "◪"); nr.title = "new session · render";
    nr.addEventListener("click", function(e){ e.stopPropagation(); closePop(); var s = makeSession(); doSplit(winId, dir, "render", s.id); });
    nrow.append(nt, nr); pop.appendChild(nrow);

    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var x = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8), y = r.bottom + 6;
    if(y + pop.offsetHeight > window.innerHeight - 8) y = r.top - pop.offsetHeight - 6;
    pop.style.left = Math.max(8, x) + "px"; pop.style.top = y + "px";
    openPop = pop;
    setTimeout(function(){ document.addEventListener("pointerdown", onDocDown, true); }, 0);
  }

  /* ---------- chrome ---------- */
  function updateChrome(){
    var lg = document.getElementById("sessLegend"); lg.innerHTML = "";
    Object.keys(sessions).forEach(function(sid){
      var s = sessions[sid];
      lg.appendChild(el("span", "s", '<span class="sd" style="background:' + s.base + '"></span>' + esc(sid) + ' ' + esc(s.name)));
    });
    var fi = document.getElementById("focusInfo");
    if(focused && windows[focused]){
      var w = windows[focused];
      fi.innerHTML = "focused: <b>" + esc(w.session) + " · " + (w.type === "term" ? "terminal" : "render") + "</b>";
    } else {
      fi.innerHTML = "focused: <b>—</b>";
    }
    var tray = document.getElementById("tray");
    tray.innerHTML = '<span class="thead">hidden:</span>';
    if(!hidden.length){ tray.appendChild(el("span", "hint", "none")); }
    else hidden.forEach(function(id){
      var w = windows[id]; if(!w) return;
      var s = sessions[w.session];
      var c = el("button", "tray-chip", '<span class="cd" style="background:' + s.base + '"></span>' + esc(w.session) + ' · ' + (w.type === "term" ? "▌" : "◪"));
      c.title = "restore " + labelOf(w);
      c.addEventListener("click", function(){ doRestore(id); });
      tray.appendChild(c);
    });
  }
  document.getElementById("newSessBtn").addEventListener("click", function(){
    var s = makeSession();
    doSplit(focused || visibleWinIds(tree)[0], "row", "term", s.id);
  });
  document.getElementById("resetBtn").addEventListener("click", resetLayout);

  /* ---------- keyboard: ⌘D / ⌘⇧D (ctrl+shift+D) split ---------- */
  window.addEventListener("keydown", function(e){
    if((e.key === "d" || e.key === "D") && (e.metaKey || (e.ctrlKey && e.shiftKey))){
      e.preventDefault();
      var anchor = (focused && findLeaf(tree, focused, null)) ? focused : visibleWinIds(tree)[0];
      if(!anchor) return;
      var sid = windows[anchor] ? windows[anchor].session : Object.keys(sessions)[0];
      doSplit(anchor, e.shiftKey ? "col" : "row", "term", sid);
    }
  });

  /* ---------- boot ---------- */
  if(!loadPersisted()) seedDefault();
  rebuild();
})();
