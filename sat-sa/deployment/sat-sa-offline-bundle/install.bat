@echo off
echo --- SAT-SA OFFLINE INSTALLER ---
echo Checking Python version...
python --version
if errorlevel 1 (
    echo Python is not installed or not in PATH!
    exit /b 1
)

echo Checking Node.js version...
node --version
if errorlevel 1 (
    echo Node.js is not installed or not in PATH!
    exit /b 1
)

echo Verifying target compatibility before offline installation...
node verify-bundle.js .
if errorlevel 1 (
    echo Bundle target does not match this machine.
    exit /b 1
)

echo Installing Python dependencies OFFLINE...
cd app\analytics
python -m pip install --no-index --find-links=../../python/ -r requirements.txt
if errorlevel 1 (
    echo Failed to install Python dependencies.
    exit /b 1
)
cd ..\..

echo Initializing database and verifying...
cd app\backend
node dist/seed.js
if errorlevel 1 (
    echo Warning: Failed to seed DB (it might already exist or seed.js might not be compiled).
)

node ../../verify-bundle.js .
if errorlevel 1 (
    echo Verification Failed!
    exit /b 1
)

echo Install complete. Run start.bat to run the application.
cd ..\..