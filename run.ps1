# SilkFlow AI one-command dev startup (Windows PowerShell)
# Starts: Hardhat node + deploy (if contracts built) -> backend -> dashboard.
# All steps degrade gracefully: missing chain => backend uses simulated chain.
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot

if (-not (Test-Path "$root\.env")) { Copy-Item "$root\.env.example" "$root\.env" }

# 1. Local chain (optional)
if (Test-Path "$root\contracts\node_modules") {
  Write-Host "[1/4] Starting Hardhat node..." -ForegroundColor Cyan
  Start-Process -WindowStyle Minimized npx -ArgumentList "hardhat","node" -WorkingDirectory "$root\contracts"
  Start-Sleep -Seconds 6
  Push-Location "$root\contracts"; npx hardhat run scripts/deploy.js --network localhost; Pop-Location
} else { Write-Host "[1/4] contracts/node_modules missing -> backend will use SIMULATED chain" -ForegroundColor Yellow }

# 2. ML models (optional, auto-trains on first API call otherwise)
if (Test-Path "$root\ml\requirements.txt") {
  Write-Host "[2/4] Training models (skip if already trained)..." -ForegroundColor Cyan
  Push-Location $root
  python -m ml.generate_data
  python -m ml.train
  Pop-Location
}

# 3. Backend
Write-Host "[3/4] Starting API on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process -WindowStyle Minimized python -ArgumentList "-m","uvicorn","app.main:app","--port","8000" -WorkingDirectory "$root\api"

# 4. Dashboard
Write-Host "[4/4] Starting dashboard on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
Write-Host "Demo login: seller@coretech.io / Password123!" -ForegroundColor Green
Push-Location "$root\dashboard"; npm run dev; Pop-Location
