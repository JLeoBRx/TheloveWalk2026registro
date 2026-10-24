@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo   THE LOVE WALK 2026 - MIGRACAO PARA R2
echo ================================================
if not exist ".env.r2" (
  echo ERRO: .env.r2 nao existe.
  echo Copie .env.r2.example para .env.r2 e preencha as credenciais da Cloudflare.
  pause
  exit /b 2
)
where py >nul 2>nul
if errorlevel 1 (
  echo ERRO: Python 3 nao encontrado. Instale Python 3.11 ou 3.12 e marque Add Python to PATH.
  pause
  exit /b 2
)
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Falha criando ambiente Python.
    pause
    exit /b 2
  )
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements-r2.txt
if errorlevel 1 (
  echo Falha instalando dependencias.
  pause
  exit /b 2
)
echo.
".venv\Scripts\python.exe" upload_to_r2.py
echo.
pause
