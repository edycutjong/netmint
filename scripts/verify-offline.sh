#!/usr/bin/env bash
# "Unplug the network → npm run demo must fail, not print a verdict."
# macOS: sandbox-exec denies outbound network; Linux: unshare -rn gives an empty network namespace.
set -u
cd "$(dirname "$0")/.."
out=$(mktemp)
# dummy keys: the failure must come from the unplugged network, never from a missing key (CI has none)
export CMC_API_KEY=offline-check-dummy ALCHEMY_API_KEY=offline-check-dummy
if command -v sandbox-exec >/dev/null 2>&1; then
  sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (local unix))(deny network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))' npx tsx scripts/demo.ts NVDA >"$out" 2>&1
elif command -v unshare >/dev/null 2>&1; then
  unshare -rn npx tsx scripts/demo.ts NVDA >"$out" 2>&1
else
  echo "no sandbox tool (sandbox-exec / unshare) available"; exit 2
fi
code=$?
cat "$out"
if [ "$code" -eq 0 ]; then echo "FAIL: demo exited 0 with the network unplugged"; exit 1; fi
if grep -qE 'REAL INFLOW|OUTFLOW|RECOUNT|NOT VERIFIABLE|FLAT ' "$out"; then echo "FAIL: a verdict was printed offline"; exit 1; fi
if ! grep -qiE 'transport error|fetch failed' "$out"; then echo "FAIL: it failed, but not on the network (expected a transport error)"; exit 1; fi
# positive control: the same command with the network ALLOWED must reach CMC and be refused for the dummy key (HTTP 401), so the
# transport error above can only come from the sandbox
ctl=$(npx tsx scripts/demo.ts NVDA 2>&1)
if ! echo "$ctl" | grep -qE 'HTTP 40[13]'; then echo "FAIL: control run with the network allowed did not reach CMC (expected HTTP 401); the check proves nothing"; echo "$ctl" | tail -3; exit 1; fi
echo "PASS: offline demo exited $code and printed no verdict (control with network: CMC answered 401 for the dummy key)"
