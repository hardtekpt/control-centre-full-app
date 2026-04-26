#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Phase 3 — Automated USB traffic capture using tshark (Wireshark CLI).
  Captures all USB traffic to/from SteelSeries devices and saves a .pcapng file.

.DESCRIPTION
  Wraps tshark to:
    1. List available USBPcap interfaces
    2. Prompt the user to identify the correct one
    3. Run a timed capture filtered to SteelSeries vendor traffic
    4. Save output for parse-wireshark.py

  PREREQUISITES (install once):
    - Wireshark with USBPcap checked during installation
      https://www.wireshark.org/download.html
    - Verify tshark is in PATH:
        tshark --version

  USAGE:
    # Interactive — prompts for interface selection
    .\capture-usb.ps1

    # Specify interface and duration
    .\capture-usb.ps1 -Interface "\\.\USBPcap1" -Duration 120

    # Capture to a specific file
    .\capture-usb.ps1 -Interface "\\.\USBPcap2" -Duration 60 -OutFile "my-capture.pcapng"
#>

param(
    [string]$Interface = "",
    [int]$Duration = 90,
    [string]$OutFile = "",
    [string]$TsharkPath = "tshark"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Resolve tshark ────────────────────────────────────────────────────────────
$tsharkExe = $TsharkPath
if (-not (Get-Command $tsharkExe -ErrorAction SilentlyContinue)) {
    $candidate = "C:\Program Files\Wireshark\tshark.exe"
    if (Test-Path $candidate) {
        $tsharkExe = $candidate
    } else {
        Write-Error "tshark not found. Install Wireshark (with USBPcap) from https://www.wireshark.org/download.html"
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Phase 3 — USB Traffic Capture" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  tshark : $tsharkExe"
Write-Host ""

# ── List capture interfaces ───────────────────────────────────────────────────
Write-Host "Available capture interfaces:" -ForegroundColor Yellow
& $tsharkExe -D 2>&1 | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# ── Select interface ──────────────────────────────────────────────────────────
if (-not $Interface) {
    Write-Host "Look for an interface named 'USBPcap1', 'USBPcap2', etc. in the list above." -ForegroundColor Yellow
    Write-Host "Tip: Unplug the headset dongle, run the capture, and see which USBPcap" -ForegroundColor Yellow
    Write-Host "  interface changes — that is the one containing your headset." -ForegroundColor Yellow
    Write-Host ""
    $Interface = Read-Host "Enter the USBPcap interface name (e.g. \\.\USBPcap1)"
}

if (-not $OutFile) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutFile = "capture-$ts.pcapng"
}

# ── Resolve output path ───────────────────────────────────────────────────────
$OutFile = [System.IO.Path]::GetFullPath($OutFile)

Write-Host ""
Write-Host "Capture settings:" -ForegroundColor Green
Write-Host "  Interface : $Interface"
Write-Host "  Duration  : $Duration seconds"
Write-Host "  Output    : $OutFile"
Write-Host ""
Write-Host "ACTION REQUIRED while capture runs:" -ForegroundColor Yellow
Write-Host "  In SteelSeries GG Engine, change each of these settings ONE AT A TIME," -ForegroundColor Yellow
Write-Host "  pausing 2-3 seconds between changes:" -ForegroundColor Yellow
Write-Host "    1. Sidetone level (cycle through all 4 values)" -ForegroundColor Yellow
Write-Host "    2. Microphone volume (change a few steps)" -ForegroundColor Yellow
Write-Host "    3. Idle timeout (change value)" -ForegroundColor Yellow
Write-Host "    4. OLED brightness (cycle through values)" -ForegroundColor Yellow
Write-Host "    5. ANC mode — off / transparency / ANC" -ForegroundColor Yellow
Write-Host "    6. EQ settings (if visible in GG)" -ForegroundColor Yellow
Write-Host "    7. Volume limiter toggle" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter when ready to start capture"
Write-Host ""
Write-Host "Capturing for $Duration seconds... (use GG Engine now)" -ForegroundColor Green

# ── Run tshark ────────────────────────────────────────────────────────────────
# -i  : interface
# -a duration:N : stop after N seconds
# -w  : write pcapng
# -q  : quiet (no per-packet stdout)
$tsharkArgs = @(
    "-i", $Interface,
    "-a", "duration:$Duration",
    "-w", $OutFile,
    "-q"
)

try {
    $proc = Start-Process -FilePath $tsharkExe -ArgumentList $tsharkArgs -NoNewWindow -PassThru -Wait
    $exitCode = $proc.ExitCode
} catch {
    Write-Error "tshark failed: $_"
}

Write-Host ""
if (Test-Path $OutFile) {
    $size = (Get-Item $OutFile).Length
    Write-Host "Capture complete!" -ForegroundColor Green
    Write-Host "  File : $OutFile"
    Write-Host "  Size : $([math]::Round($size / 1024, 1)) KB"
    Write-Host ""
    Write-Host "NEXT STEP → Run parse-wireshark.py against the captured file:" -ForegroundColor Cyan
    Write-Host "  python parse-wireshark.py --pcap `"$OutFile`"" -ForegroundColor White
} else {
    Write-Warning "Output file not found after capture. tshark exit code: $exitCode"
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  - Run PowerShell as Administrator"
    Write-Host "  - Verify the interface name with: tshark -D"
    Write-Host "  - Try Wireshark GUI to confirm USBPcap sees your device"
}
