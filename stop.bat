@echo off
cd /d "%~dp0"

echo.
echo  Stopping Sentinel databases...
echo.

docker compose -f infra/compose/docker-compose.yml stop postgres redis minio mailpit

echo.
echo  Done. The two server windows (API + Web) can be
echo  closed manually, or press Ctrl+C inside them.
echo.
pause
