@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Install Python 3 to run Canopy locally.
        pause
        exit /b 1
    )
    python serve.py
) else (
    py -3 serve.py
)
if errorlevel 1 pause
