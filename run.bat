@echo off
title ProofChain
setlocal
cd /d "%~dp0"

echo.
echo  ============================================
echo   PROOFCHAIN - one-click local stack
echo   chain :8545 / api :4000 / ai :8000 / web :5173
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Install Node 18+ from https://nodejs.org and run this again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [SETUP] First run - installing npm dependencies. This can take a few minutes...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. See the output above.
        pause
        exit /b 1
    )
)

REM Open the app in the default browser once the dev servers have had time to boot.
start "" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:5173"

echo [START] Launching the full stack (Hardhat chain, contracts, API, AI service, web app)...
echo         First run also deploys contracts, creates the database and the Python venv.
echo         Press Ctrl+C in this window to stop everything.
echo.

call npm run dev

echo.
echo ProofChain stopped.
pause
