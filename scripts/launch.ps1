# Research OS launcher for the Desktop / Start Menu shortcut (via launch.vbs, so no console window ever shows).
# Starts the server hidden if it is not answering, waits until it answers, then opens the browser.
# First run: shows the one-time setup token (also copied to the clipboard). Errors: message box + data\logs\launcher.log.
# -Phone (Start-with-phone.bat, ADR-278): listen on this computer's Wi-Fi address so the paired phone can reach it.
# RESEARCHOS_HEADLESS=1: no dialog, no browser (the CI smoke test). Windows: started headless on a GitHub runner only.
param([switch]$Phone)
$ErrorActionPreference = 'Stop'
$Headless = $env:RESEARCHOS_HEADLESS -eq '1'
$AppRoot = Split-Path -Parent $PSScriptRoot
$InstallData = Join-Path (Split-Path -Parent $AppRoot) 'data'
if (Test-Path $InstallData) { $env:RESEARCHOS_DATA_DIR = $InstallData }   # the data dir next to app\ wins
. "$PSScriptRoot\_common.ps1"
Add-Type -AssemblyName System.Windows.Forms
$LogDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'launcher.log'
function Write-Log([string]$m) { Add-Content -Path $Log -Value ("{0:s} {1}" -f (Get-Date), $m) -Encoding UTF8 }

function Get-Url {
  $cfg = Join-Path $DataDir 'config\researchos.toml'
  $h, $p, $tls = '127.0.0.1', '8443', $false
  if (Test-Path $cfg) {
    foreach ($line in Get-Content $cfg) {
      if ($line -match '^\s*host\s*=\s*"([^"]+)"') { $h = $Matches[1] }
      if ($line -match '^\s*port\s*=\s*(\d+)') { $p = $Matches[1] }
      if ($line -match '^\s*tls_cert_file\s*=') { $tls = $true }
    }
  }
  if ($h -eq '0.0.0.0') { $h = '127.0.0.1' }
  return ('{0}://{1}:{2}/' -f ($(if ($tls) { 'https' } else { 'http' }), $h, $p))
}

function Test-Up([string]$url) {
  try {
    # our own self-signed LAN certificate (install -Lan): this process only talks to its own server
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    $r = Invoke-WebRequest -Uri ($url + 'api/v1/health') -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Use-Phone {
  # the first private IPv4 address (the server's own list); the server then accepts the app's pairing calls
  $ip = (& $Py -m researchos.app.cli lan-urls | Select-Object -First 1) -replace '^https?://', '' -replace ':\d+$', ''
  if (-not $ip) { throw 'no Wi-Fi / LAN address found: connect this computer to the same Wi-Fi as the phone' }
  $env:RESEARCHOS_HOST = $ip
  $env:RESEARCHOS_ALLOW_INSECURE_LAN = '1'
  $env:RESEARCHOS_MOBILE_APP_ORIGINS = '1'
  $env:RESEARCHOS_PUBLIC_ORIGINS = "http://${ip}:8443"
  return "http://${ip}:8443/"
}

function Show-Info([string]$text) {
  if ($Headless) { Write-Log 'info dialog skipped (headless)'; return }
  [System.Windows.Forms.MessageBox]::Show($text, 'Research OS', 'OK', 'Information') | Out-Null
}

try {
  Assert-Venv
  $url = if ($Phone) { Use-Phone } else { Get-Url }
  if (-not (Test-Up $url)) {
    if ($Phone) { & (Join-Path $PSScriptRoot 'stop.ps1') *>&1 | ForEach-Object { Write-Log "$_" } }   # one started for this computer only
    Write-Log "starting server for $url"
    # through Write-Log, not an append redirect: PowerShell 5.1 appends redirected output as UTF-16 and the log became unreadable
    & (Join-Path $PSScriptRoot 'start.ps1') *>&1 | ForEach-Object { Write-Log "$_" }
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Up $url)) {
      if ((Get-Date) -gt $deadline) { throw "the server did not answer at $url within 90 s" }
      Start-Sleep -Milliseconds 700
    }
  }
  $tokenFile = Join-Path $DataDir 'config\setup-token.txt'
  if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if (-not $Headless) { Set-Clipboard -Value $token }
    Show-Info ("First start: create your account in the browser with this one-time setup token (already copied):`n`n$token`n`n" +
      "首次启动：请在浏览器中用这个一次性设置口令创建账号（已复制到剪贴板）。")
  }
  if ($Phone) {
    Show-Info ("On the phone (same Wi-Fi), type this computer address, then pair with the code from Settings > Devices:`n`n$url`n`n" +
      "手机（同一个 Wi-Fi）：设置 → 连接电脑 → 电脑地址填上面这个，再用电脑「设置 → 设备」里的配对码配对。")
  }
  Write-Log "ready at $url"
  if (-not $Headless) { Start-Process $url }
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  if ($Headless) { Write-Error $_.Exception.Message; exit 1 }
  [System.Windows.Forms.MessageBox]::Show(
    "Research OS could not start:`n$($_.Exception.Message)`n`nLog: $Log", 'Research OS', 'OK', 'Error') | Out-Null
  exit 1
}
