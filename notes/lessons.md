# Lessons — duet

| Date | Tag | Lesson |
|------|-----|--------|
| 2026-07-10 | [PROJECT:duet] | WebKit suspends requestAnimationFrame when a window is occluded/invisible — any WKWebView bench/automation stub launched from a background process must force visibility (`win.level = .floating` + `orderFrontRegardless()`) or async work silently stalls at sample zero. |
| 2026-07-10 | [PROJECT:duet] | Tauri names the bundle executable after the CARGO PACKAGE name, not `productName` — a package named `app` ships `Contents/MacOS/app`, breaking `pgrep -x duet`. Rename the package (lib name can stay). |
| 2026-07-10 | [PROJECT:duet] | Tauri sidecar v1 pattern that worked: node binary as `externalBin` (target-triple suffix) + prod server copy as `resources`; server.js needed ZERO changes because it resolves everything via `__dirname`/`os.homedir()`. Kill-on-quit only for a server the app spawned — attach leaves external servers alive. |
| 2026-07-10 | [GEN] | Delivering big binaries to external people: Gmail rejects .js-inside-zip archives; the personal google-workspace MCP `create_drive_file` fails on ~76MB (`Redirected but the response is missing a Location header`) even from its staging dir. WhatsApp `send_file` handles it; verify in `bridge.run.log` (byte count), never re-send. |
| 2026-07-10 | [CLAUDE] | Double-rAF "write→frame" latency readings are vsync-quantized (~30ms at 60Hz) in EVERY engine — only compare across engines, never against a sub-frame budget; use the write-callback metric for parse-path budgets. |
