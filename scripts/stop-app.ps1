# Stops the app started by scripts\start-app.cmd (the "Inventory app" scheduled task).
# Ending the task in Task Scheduler is not enough: it leaves the launcher and server running.
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 3005 }))

# Launcher first, so it can't restart the server after we stop it.
$launchers = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'start-app\.cmd' }
foreach ($l in $launchers) { Stop-Process -Id $l.ProcessId -Force -ErrorAction SilentlyContinue }

$stopped = 0
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conn) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
  # Only our Next.js server; never another program that happens to use the port.
  if ($p -and $p.CommandLine -match 'next.*start') { Stop-Process -Id $p.ProcessId -Force; $stopped++ }
  elseif ($p) { Write-Host "Port $Port is used by another program ($($p.Name)); not stopping it." }
}
Write-Host "Stopped $(@($launchers).Count) launcher(s) and $stopped server(s)."
