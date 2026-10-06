# Kill whatever is holding :3000 (and orphan next/node for this repo).
$ErrorActionPreference = "Continue"
$port = 3000

$pids = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object { $_ -and $_ -ne 0 })

foreach ($procId in $pids) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) {
    Write-Host "kill $($p.ProcessName) pid=$procId (port $port)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -match 'wardogs-tactical-map' -or
    $_.CommandLine -match 'next (dev|start)' -or
    $_.CommandLine -match 'next-server'
  } |
  ForEach-Object {
    Write-Host "kill orphan node pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Milliseconds 500
$left = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
if ($left.Count) {
  Write-Host "WARN: port $port still has $($left.Count) connection(s)"
} else {
  Write-Host "port $port free"
}
