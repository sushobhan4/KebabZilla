@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "FRONTEND_DIR=%PROJECT_DIR%frontend"

if not exist "%BACKEND_DIR%\.venv\Scripts\python.exe" (
  echo Backend virtual environment not found.
  echo From the backend folder, run: py -3 -m venv .venv
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo Frontend dependencies not found.
  echo From the frontend folder, run: npm install
  pause
  exit /b 1
)

set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"

if not exist "%CLOUDFLARED%" set "CLOUDFLARED=cloudflared"

start "KebabZilla Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && ""%BACKEND_DIR%\.venv\Scripts\python.exe"" -m alembic upgrade head && ""%BACKEND_DIR%\.venv\Scripts\python.exe"" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
start "KebabZilla Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev"
start "KebabZilla Cloudflare Tunnel" cmd /k call "%CLOUDFLARED%" tunnel --url http://localhost:5173

endlocal

