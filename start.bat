@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Sentinel - Self-hosted Playwright Tests
echo  ==========================================
echo.

REM ── Check Docker is installed ────────────────────────────────────────────────
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Docker Desktop is not installed.
    echo.
    echo  Please install it from:
    echo    https://www.docker.com/products/docker-desktop/
    echo.
    echo  After installing: open Docker Desktop, wait for
    echo  the green whale icon, then run this file again.
    echo.
    pause
    exit /b 1
)

REM ── Check Docker engine is actually running ──────────────────────────────────
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Docker is installed but not running.
    echo.
    echo  Please open Docker Desktop and wait until the
    echo  bottom-left shows "Engine running", then run
    echo  this file again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Docker is running

REM ── Install packages (only if needed) ────────────────────────────────────────
if not exist "node_modules" (
    echo  [1/4] Installing packages - this takes 1-2 min...
    call pnpm install
    if %errorlevel% neq 0 (
        echo  ERROR: pnpm install failed. See above for details.
        pause
        exit /b 1
    )
    echo  [OK] Packages installed
) else (
    echo  [1/4] Packages already installed - skipping
)

REM ── Build shared packages (needed by web + api) ─────────────────────────────
echo  [2/5] Building shared packages...
call pnpm --filter @sentinel/db run db:generate 2>&1
call pnpm --filter @sentinel/db run build 2>&1
call pnpm --filter @sentinel/shared run build 2>&1
call pnpm --filter @sentinel/ui run build 2>&1
call pnpm --filter @sentinel/ir run build 2>&1
echo  [OK] Packages built

REM ── Start databases ───────────────────────────────────────────────────────────
echo  [3/5] Starting databases (postgres, redis, minio, mailpit)...
docker compose -f infra/compose/docker-compose.yml up -d postgres redis minio mailpit
if %errorlevel% neq 0 (
    echo  ERROR: Could not start Docker services.
    pause
    exit /b 1
)

echo  Waiting for database to be ready...
timeout /t 6 /nobreak >nul

REM ── Run migrations ────────────────────────────────────────────────────────────
echo  [4/5] Setting up database...
call pnpm db:migrate 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Database migration failed.
    echo  Make sure Docker services are healthy and try again.
    pause
    exit /b 1
)

REM ── Seed demo data (safe to run multiple times) ───────────────────────────────
call pnpm db:seed 2>&1
echo  [OK] Database ready

REM ── Open API server in new window ─────────────────────────────────────────────
echo  [5/5] Starting servers...
start "Sentinel API  :3001" cmd /k "cd /d "%~dp0apps\api" && echo Starting API... && node --env-file=.env --import tsx/esm --watch src/server.ts"

REM ── Open Web server in new window ─────────────────────────────────────────────
start "Sentinel Web  :3000" cmd /k "cd /d "%~dp0apps\web" && echo Starting Web... && pnpm dev"

echo.
echo  ==========================================
echo.
echo   Two new windows are opening now.
echo   Wait ~20 seconds for them to fully start.
echo.
echo   Then open your browser and go to:
echo.
echo     http://localhost:3000
echo.
echo   Login:  demo@sentinel.local
echo   Pass:   demo1234
echo.
echo  ==========================================
echo.
echo  Other useful links:
echo    API docs:  http://localhost:3001/docs
echo    Files:     http://localhost:9001  (user: sentinel / sentinel_secret)
echo    Emails:    http://localhost:8025
echo.
echo  To stop everything: close the two server windows,
echo  then run stop.bat
echo.
pause
