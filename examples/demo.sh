#!/bin/sh
# duet demo — writes three cards to the session canvas, then updates one in place.
# POSIX sh. Run this inside a duet terminal pane.

set -eu

if [ -z "${DUET_CANVAS:-}" ]; then
  echo "duet demo: \$DUET_CANVAS is not set — run me inside a duet terminal pane." >&2
  exit 1
fi

echo "duet demo: writing cards to $DUET_CANVAS"

# ---- card 1: a styled note -------------------------------------------------
cat > "$DUET_CANVAS/01-hello.html" <<'EOF'
<title>Hello from a shell script</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif;
         background: #14161b; color: #e8eaf0; padding: 28px; }
  .note { max-width: 520px; border: 1px solid #2c313c; border-left: 4px solid #7aa2f7;
          border-radius: 10px; padding: 20px 24px; background: #1a1d24; }
  h1 { margin: 0 0 10px; font-size: 20px; font-weight: 650; }
  p { margin: 6px 0; line-height: 1.55; color: #b8bdc9; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em;
         background: #262b36; border-radius: 4px; padding: 1px 6px; color: #e8eaf0; }
</style>
<div class="note">
  <h1>Hello from a shell script</h1>
  <p>This card is a plain <code>.html</code> file that <code>demo.sh</code> just wrote to
     <code>$DUET_CANVAS</code>. No SDK, no server call &mdash; the canvas is a directory.</p>
  <p>Two more cards are on their way. Then watch the chart update <em>in place</em>.</p>
</div>
EOF
echo "  01-hello.html   mounted"
sleep 1

# ---- card 2: an animated bar chart ----------------------------------------
cat > "$DUET_CANVAS/02-chart.html" <<'EOF'
<title>Deploys per day</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif;
         background: #14161b; color: #e8eaf0; padding: 24px 28px; }
  h1 { margin: 0 0 2px; font-size: 17px; font-weight: 650; }
  .sub { margin: 0 0 18px; font-size: 12.5px; color: #8a90a0; }
  .chart { display: flex; align-items: flex-end; gap: 14px; height: 180px;
           max-width: 560px; border-bottom: 1px solid #2c313c; padding-bottom: 2px; }
  .col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end;
         align-items: center; height: 100%; min-width: 0; }
  .bar { width: 70%; border-radius: 5px 5px 0 0; background: #7aa2f7;
         height: 0; transition: height 700ms cubic-bezier(.22,1,.36,1); }
  .val { font-size: 11.5px; color: #b8bdc9; margin-bottom: 5px;
         opacity: 0; transition: opacity 500ms ease 500ms; }
  .lbl { margin-top: 8px; font-size: 11.5px; color: #8a90a0; }
</style>
<h1>Deploys per day</h1>
<p class="sub">this week &middot; one series</p>
<div class="chart" id="chart"></div>
<script>
  var data = [["Mon",4],["Tue",7],["Wed",3],["Thu",9],["Fri",6]];
  var max = 10, chart = document.getElementById("chart");
  data.forEach(function (d) {
    var col = document.createElement("div"); col.className = "col";
    col.innerHTML = '<div class="val">' + d[1] + '</div>' +
                    '<div class="bar"></div>' +
                    '<div class="lbl">' + d[0] + '</div>';
    chart.appendChild(col);
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var bars = chart.querySelectorAll(".bar"), vals = chart.querySelectorAll(".val");
      data.forEach(function (d, i) {
        bars[i].style.height = (d[1] / max * 100) + "%";
        vals[i].style.opacity = "1";
      });
    });
  });
</script>
EOF
echo "  02-chart.html   mounted"
sleep 1

# ---- card 3: a styled table -------------------------------------------------
cat > "$DUET_CANVAS/03-table.html" <<'EOF'
<title>Service status</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif;
         background: #14161b; color: #e8eaf0; padding: 24px 28px; }
  h1 { margin: 0 0 14px; font-size: 17px; font-weight: 650; }
  table { border-collapse: collapse; width: 100%; max-width: 560px; font-size: 13.5px; }
  th { text-align: left; font-weight: 600; color: #8a90a0; font-size: 11.5px;
       text-transform: uppercase; letter-spacing: 0.06em;
       padding: 8px 14px; border-bottom: 1px solid #2c313c; }
  td { padding: 9px 14px; border-bottom: 1px solid #22262f; color: #c9cdd8; }
  tr:last-child td { border-bottom: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums;
           font-family: ui-monospace, Menlo, monospace; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
         margin-right: 8px; vertical-align: 1px; }
  .ok { background: #9ece6a; } .warn { background: #e0af68; }
</style>
<h1>Service status</h1>
<table>
  <tr><th>Service</th><th>State</th><th style="text-align:right">p99 (ms)</th><th style="text-align:right">Uptime</th></tr>
  <tr><td>api-gateway</td><td><span class="dot ok"></span>healthy</td><td class="num">41</td><td class="num">99.99%</td></tr>
  <tr><td>worker-pool</td><td><span class="dot ok"></span>healthy</td><td class="num">120</td><td class="num">99.97%</td></tr>
  <tr><td>search-index</td><td><span class="dot warn"></span>degraded</td><td class="num">640</td><td class="num">99.61%</td></tr>
  <tr><td>postgres-primary</td><td><span class="dot ok"></span>healthy</td><td class="num">8</td><td class="num">100.00%</td></tr>
</table>
EOF
echo "  03-table.html   mounted"

sleep 2

# ---- update card 2 IN PLACE: same filename, extra data series ---------------
cat > "$DUET_CANVAS/02-chart.html" <<'EOF'
<title>Deploys per day — this week vs last</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", sans-serif;
         background: #14161b; color: #e8eaf0; padding: 24px 28px; }
  h1 { margin: 0 0 2px; font-size: 17px; font-weight: 650; }
  .sub { margin: 0 0 12px; font-size: 12.5px; color: #8a90a0; }
  .legend { display: flex; gap: 18px; margin: 0 0 14px; font-size: 12px; color: #b8bdc9; }
  .key { display: inline-block; width: 10px; height: 10px; border-radius: 3px;
         margin-right: 6px; vertical-align: -1px; }
  .chart { display: flex; align-items: flex-end; gap: 18px; height: 180px;
           max-width: 560px; border-bottom: 1px solid #2c313c; padding-bottom: 2px; }
  .col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end;
         align-items: center; height: 100%; min-width: 0; }
  .pair { display: flex; align-items: flex-end; gap: 5px; width: 82%; height: 100%; }
  .bar { flex: 1; border-radius: 5px 5px 0 0; height: 0;
         transition: height 700ms cubic-bezier(.22,1,.36,1); }
  .a { background: #7aa2f7; } .b { background: #57534e; }
  .lbl { margin-top: 8px; font-size: 11.5px; color: #8a90a0; }
</style>
<h1>Deploys per day</h1>
<p class="sub">updated in place &mdash; same file, overwritten by demo.sh</p>
<div class="legend">
  <span><span class="key" style="background:#7aa2f7"></span>this week</span>
  <span><span class="key" style="background:#57534e"></span>last week</span>
</div>
<div class="chart" id="chart"></div>
<script>
  var data = [["Mon",4,2],["Tue",7,5],["Wed",3,6],["Thu",9,4],["Fri",6,5]];
  var max = 10, chart = document.getElementById("chart");
  data.forEach(function (d) {
    var col = document.createElement("div"); col.className = "col";
    col.innerHTML = '<div class="pair">' +
                    '<div class="bar a" title="this week: ' + d[1] + '"></div>' +
                    '<div class="bar b" title="last week: ' + d[2] + '"></div>' +
                    '</div><div class="lbl">' + d[0] + '</div>';
    chart.appendChild(col);
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      chart.querySelectorAll(".col").forEach(function (col, i) {
        col.querySelector(".a").style.height = (data[i][1] / max * 100) + "%";
        col.querySelector(".b").style.height = (data[i][2] / max * 100) + "%";
      });
    });
  });
</script>
EOF
echo "  02-chart.html   UPDATED in place (second series added)"

echo "duet demo: done. Cleanup: rm \"\$DUET_CANVAS\"/0*-*.html"
