@echo off
setlocal

if "%~1"=="" (
  echo Usage:
  echo   update-installed.cmd "C:\path\to\Tracer-Setup-x.y.z.exe"
  echo.
  echo You can also drag and drop the installer EXE onto this .cmd file.
  exit /b 1
)

set "INSTALLER_PATH=%~1"
shift

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-installed.ps1" -InstallerPath "%INSTALLER_PATH%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Update failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo.
echo Update completed successfully.
exit /b 0
