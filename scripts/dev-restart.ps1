# Kill anything glued to :3000 and start a fresh Next dev server.
$ErrorActionPreference = "Stop"
$port = 3000
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "package.json"))) {
  $root = "C:\Users\h4zy\Desktop\wardogs-tactical-map"
}

Write-Host "Freeing port $port..."
$pids = @()
try {
  $pids = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne 0 })
} catch {}

foreach ($procId in $pids) {
  try {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host "  kill $($p.ProcessName) pid=$procId"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

# Orphan next/node leftovers from prior Cursor terminals
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -match 'wardogs-tactical-map' -or
    $_.CommandLine -match 'next (dev|start)' -or
    $_.CommandLine -match 'next-server'
  } |
  ForEach-Object {
    Write-Host "  kill orphan node pid=$($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 1
$still = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($still) {
  Write-Host "Port $port still busy — waiting..."
  Start-Sleep -Seconds 2
}

Set-Location $root
Write-Host "Starting next dev on http://127.0.0.1:$port"
npm run dev -- -p $port -H 127.0.0.1
