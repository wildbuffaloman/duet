#!/usr/bin/env bash
# Asserts the contract-aware linter's exit codes against fixtures.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
lint(){ node "$here/lint-templates.js" "$1" >/dev/null 2>&1; echo $?; }
fail=0
[ "$(lint "$here/__lint_fixtures__/pass-nokit")" = 0 ] || { echo "EXPECTED PASS: pass-nokit"; fail=1; }
[ "$(lint "$here/__lint_fixtures__/fail-nometa")" = 1 ] || { echo "EXPECTED FAIL: fail-nometa"; fail=1; }
[ "$(lint "$here/__lint_fixtures__/fail-kit")" = 1 ] || { echo "EXPECTED FAIL: fail-kit"; fail=1; }
[ "$fail" = 0 ] && echo "test-lint: OK" || { echo "test-lint: FAIL"; exit 1; }
