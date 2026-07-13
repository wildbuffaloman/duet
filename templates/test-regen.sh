#!/usr/bin/env bash
set -u
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mk(){ cat > "$tmp/$1.html" <<EOF
<!doctype html><head>
<!-- HTML-TEMPLATE-META
name: $1
category: $2
task-shape: shape-$1
data-blocks: D
capabilities: palette=light
updated: 2026-07-13
-->
<title>$1</title></head><body><script>"use strict";
/* ===== DATA BLOCKS ===== */ const D={}; /* ===== END DATA BLOCKS ===== */
</script></body>
EOF
}
mk alpha dashboard; mk beta critique
cat > "$tmp/gamma.html" <<'EOF'
<!doctype html><head>
<!-- HTML-TEMPLATE-META
name: gamma
category: dashboard
task-shape: show A | B split view
data-blocks: D
capabilities: palette=light
updated: 2026-07-13
-->
<title>gamma</title></head><body><script>"use strict";
/* ===== DATA BLOCKS ===== */ const D={}; /* ===== END DATA BLOCKS ===== */
</script></body>
EOF
printf '# lib\n<!-- TEMPLATES-TABLE:BEGIN -->\nold\n<!-- TEMPLATES-TABLE:END -->\n' > "$tmp/README.md"
printf '# skill\n<!-- ROUTING-TABLE:BEGIN -->\nold\n<!-- ROUTING-TABLE:END -->\n' > "$tmp/SKILL.md"
node "$here/regen-indexes.js" "$tmp" "$tmp/SKILL.md" >/dev/null || { echo "regen crashed"; exit 1; }
grep -q "alpha.html" "$tmp/README.md" && grep -q "beta.html" "$tmp/README.md" \
  && grep -q "shape-alpha" "$tmp/SKILL.md" && ! grep -q "^old$" "$tmp/README.md" \
  && grep -qF 'show A \| B' "$tmp/README.md" \
  && grep -qF 'show A \| B' "$tmp/SKILL.md" \
  && echo "test-regen: OK" || { echo "test-regen: FAIL"; exit 1; }
