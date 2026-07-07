@echo off
rem ARX Drawing Checker for Civil 3D / AutoCAD.
rem Needs Python 3 (python.org, "py launcher" enabled) - everything else
rem installs offline from the bundled wheels.

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 is not installed. Get it from https://www.python.org/downloads/
  echo and tick "py launcher" during setup, then run this file again.
  pause
  exit /b 1
)

py -3 -c "import win32com.client, pypdf" >nul 2>nul
if errorlevel 1 (
  echo First run - installing pywin32 and pypdf from the bundled wheels...
  py -3 -m pip install --no-index --find-links "%~dp0wheels" pywin32 pypdf
  if errorlevel 1 (
    echo Offline install failed - trying online...
    py -3 -m pip install pywin32 pypdf
  )
)

py -3 "%~dp0checker\app.py"
if errorlevel 1 pause
