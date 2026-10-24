@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend-fastAPI"
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

echo ========================================================
echo Building Frontend Production Bundle...
echo ========================================================
cd /d "%FRONTEND_DIR%"
call npm run build
if %ERRORLEVEL% neq 0 (
  echo Frontend build failed.
  pause
  exit /b %ERRORLEVEL%
)

echo.
echo Starting Backend and Frontend Preview servers...
start "KebabZilla Backend (Prod Mode)" cmd /k "cd /d ""%BACKEND_DIR%"" && ""%BACKEND_DIR%\.venv\Scripts\python.exe"" -m alembic upgrade head && ""%BACKEND_DIR%\.venv\Scripts\python.exe"" -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "KebabZilla Frontend (Preview Mode)" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run preview -- --port 4173"

echo.
echo ========================================================
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:4173
echo ========================================================
endlocal
