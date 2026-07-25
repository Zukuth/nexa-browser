# Launches the NexaBrowserTest AVD and centers its window on the primary
# screen. The emulator never remembers window position/size across launches
# (confirmed empirically — its Qt settings only store adb/clipboard prefs,
# nothing about geometry), and its default placement can land partly
# off-screen depending on the host display setup. Centering it here every
# time is the reliable fix, not a one-off manual reposition.
#
# Usage: powershell -File android/scripts/run-emulator.ps1

$ErrorActionPreference = "Stop"

$androidHome = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Android\sdk" }
$emulator = Join-Path $androidHome "emulator\emulator.exe"
$avdName = "NexaBrowserTest"

Start-Process -FilePath $emulator -ArgumentList "-avd", $avdName, "-no-snapshot", "-no-audio"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EmuWindow {
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$winW = 400
$winH = 760
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$left = [int](($screen.Width - $winW) / 2)
$top = [int](($screen.Height - $winH) / 2)

# The window doesn't exist the instant the process starts — poll briefly.
$deadline = (Get-Date).AddSeconds(30)
$proc = $null
while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name "qemu-system-x86_64" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$avdName*" }
    if ($proc) { break }
    Start-Sleep -Milliseconds 500
}

if ($proc) {
    [EmuWindow]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
    [EmuWindow]::MoveWindow($proc.MainWindowHandle, $left, $top, $winW, $winH, $true) | Out-Null
    [EmuWindow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Write-Output "Emulator window centered at ($left, $top), size ${winW}x${winH}."
} else {
    Write-Warning "Emulator process started but its window wasn't found within 30s — it may still be booting."
}
