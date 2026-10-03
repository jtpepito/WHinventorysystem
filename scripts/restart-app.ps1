# Restarts the app via its scheduled task (e.g. after "npm run build").
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 3005 }))
$task = 'Inventory app'

& "$PSScriptRoot\stop-app.ps1" -Port $Port

# The task keeps showing Running for a moment after its launcher stops, and a start
# issued then is ignored (one instance at a time), so wait for it to settle.
for ($i = 0; $i -lt 20 -and (Get-ScheduledTask -TaskName $task).State -eq 'Running'; $i++) { Start-Sleep -Milliseconds 500 }
if ((Get-ScheduledTask -TaskName $task).State -eq 'Running') { Stop-ScheduledTask -TaskName $task; Start-Sleep 1 }

Start-ScheduledTask -TaskName $task
for ($i = 0; $i -lt 30; $i++) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Inventory app is running: http://localhost:$Port"
    exit 0
  }
  Start-Sleep 1
}
Write-Host "The app did not start within 30 seconds. See logs\app.log."
exit 1
