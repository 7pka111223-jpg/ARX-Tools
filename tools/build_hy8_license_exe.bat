@echo off
rem Builds ARX-HY8-License-Admin.exe from tools\hy8_license_admin.py.
rem Run on Windows, from the repository root. One-time setup:
rem     pip install pyinstaller
rem The .exe embeds the PRIVATE signing key - vendor use only, never ship it.

pyinstaller --onefile --windowed --name ARX-HY8-License-Admin ^
    --distpath tools\dist --workpath tools\build --specpath tools\build ^
    tools\hy8_license_admin.py

if errorlevel 1 (
    echo Build failed - is PyInstaller installed?  pip install pyinstaller
    exit /b 1
)
echo.
echo Done: tools\dist\ARX-HY8-License-Admin.exe
