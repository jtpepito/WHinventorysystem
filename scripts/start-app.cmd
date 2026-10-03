@echo off
rem Starts the production server and restarts it if it ever exits (run "npm run build" first after code changes).
rem Used by the "Inventory app" scheduled task; output goes to logs\app.log.
rem Task Scheduler's own "restart on failure" only covers launch failures, hence the loop here.
cd /d "%~dp0.."
if not defined PORT set PORT=3005
if not exist logs mkdir logs
rem One copy only: if the app is already serving, leave it alone.
netstat -ano -p tcp | findstr /r /c:":%PORT% .*LISTENING" > nul && (
  echo [%date% %time%] port %PORT% already in use; not starting another copy >> logs\app.log
  exit /b 0
)
:loop
echo [%date% %time%] starting on port %PORT% >> logs\app.log
node node_modules\next\dist\bin\next start -p %PORT% >> logs\app.log 2>&1
echo [%date% %time%] server exited with code %errorlevel%; restarting in 10 seconds >> logs\app.log
rem ping as a sleep: "timeout" fails without a console.
ping -n 11 127.0.0.1 > nul
goto loop
