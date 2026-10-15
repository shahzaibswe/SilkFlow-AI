#!/usr/bin/env bash
# SilkFlow AI one command dev startup (Git Bash / Linux / macOS)
set -u
root="$(cd "$(dirname "$0")" && pwd)"
[ -f "$root/.env" ] || cp "$root/.env.example" "$root/.env"

cleanup() { jobs -p | xargs -r kill 2>/dev/null; }
trap cleanup EXIT INT TERM

if [ -d "$root/contracts/node_modules" ]; then
  echo "[1/4] Hardhat node..."
  (cd "$root/contracts" && npx hardhat node >/tmp/silkflow-chain.log 2>&1 &)
  sleep 6
  (cd "$root/contracts" && npx hardhat run scripts/deploy.js --network localhost)
else
  echo "[1/4] no contracts/node_modules -> backend uses SIMULATED chain"
fi

echo "[2/4] ML data + training..."
(cd "$root" && python -m ml.generate_data && python -m ml.train) || echo "  (ml step failed; backend will use fallback scorer)"

echo "[3/4] API :8000 ..."
(cd "$root/api" && python -m uvicorn app.main:app --port 8000 &)
sleep 3

echo "[4/4] Dashboard :5173 ...  Demo login: seller@coretech.io / Password123!"
cd "$root/dashboard" && npm run dev
