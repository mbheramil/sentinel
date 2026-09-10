$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  =========================================="
Write-Host "    Sentinel - Self-hosted Playwright Tests"
Write-Host "  =========================================="
Write-Host ""

# Check Docker
try { docker info 2>&1 | Out-Null } catch {
    Write-Host "  ERROR: Docker is not running." -ForegroundColor Red
    Write-Host "  Open Docker Desktop and wait for 'Engine running', then try again."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  [OK] Docker is running" -ForegroundColor Green

# Install packages if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "  [1/4] Installing packages (first time, ~2 min)..."
    pnpm install
}
else {
    Write-Host "  [1/4] Packages already installed"
}

# Start databases
Write-Host "  [2/4] Starting databases..."
docker compose -f infra/compose/docker-compose.yml up -d postgres redis minio mailpit
Start-Sleep 8

# Migrate + seed
Write-Host "  [3/4] Setting up database..."
Set-Location packages\db
$env:DATABASE_URL = "postgres://sentinel:sentinel@localhost:5432/sentinel"
npx prisma generate
npx prisma migrate dev --name init 2>&1 | Out-Null
$env:DATABASE_URL = "postgres://sentinel:sentinel@localhost:5432/sentinel"
npx tsx --env-file=.env prisma/seed.ts
Set-Location $PSScriptRoot
Write-Host "  [OK] Database ready" -ForegroundColor Green

# Start API in new window
Write-Host "  [4/4] Starting servers..."
$apiPath = Join-Path $PSScriptRoot "apps\api"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$apiPath'; Write-Host 'Starting API...' -ForegroundColor Cyan; node --env-file=.env --import tsx/esm --watch src/server.ts"

# Start Web in new window
$webPath = Join-Path $PSScriptRoot "apps\web"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$webPath'; Write-Host 'Starting Web...' -ForegroundColor Cyan; pnpm dev"

Write-Host ""
Write-Host "  =========================================="
Write-Host ""
Write-Host "   Two windows are opening."
Write-Host "   Wait ~20 seconds, then open:"
Write-Host ""
Write-Host "     http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Login:  demo@sentinel.local"
Write-Host "   Pass:   demo1234"
Write-Host ""
Write-Host "  =========================================="
Write-Host ""
Read-Host "Press Enter to close this window"
