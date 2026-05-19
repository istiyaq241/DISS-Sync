@echo off
setlocal

if "%~1"=="" (
  echo Usage: scripts\import_routine.cmd "C:\path\to\routine.xlsx" [--dry-run] [--replace]
  exit /b 1
)

set "INPUT_FILE=%~1"
set "PROJECT_ROOT=%~dp0.."
set "OUTPUT_FILE=%PROJECT_ROOT%\data.json"
set "PYTHON_EXE=python"
set "NODE_EXE=node"
set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if exist "%CODEX_PYTHON%" set "PYTHON_EXE=%CODEX_PYTHON%"
if exist "%CODEX_NODE%" set "NODE_EXE=%CODEX_NODE%"

pushd "%PROJECT_ROOT%"

"%PYTHON_EXE%" ".\scripts\excel_to_json.py" "%INPUT_FILE%" "%OUTPUT_FILE%"
if errorlevel 1 exit /b %errorlevel%

set "UPLOAD_ARGS=--data=%OUTPUT_FILE%"

if /I "%~2"=="--dry-run" set "UPLOAD_ARGS=%UPLOAD_ARGS% --dry-run"
if /I "%~2"=="--replace" set "UPLOAD_ARGS=%UPLOAD_ARGS% --replace"
if /I "%~3"=="--dry-run" set "UPLOAD_ARGS=%UPLOAD_ARGS% --dry-run"
if /I "%~3"=="--replace" set "UPLOAD_ARGS=%UPLOAD_ARGS% --replace"

"%NODE_EXE%" ".\scripts\upload_to_firestore.js" %UPLOAD_ARGS%

popd
endlocal
