
param([string]$ExpectedTitle, [string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class EvCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
[EvCap]::SetProcessDPIAware() | Out-Null
$normalize = { param($s) (($s -replace '\p{Zs}+', ' ')).Trim() }
$exp = & $normalize $ExpectedTitle
$procs = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle }
$best = $null
$bestScore = -1
foreach ($p in $procs) {
  $t = & $normalize $p.MainWindowTitle
  if (-not $t) { continue }
  $score = 0
  if ($exp) {
    if ($t.IndexOf($exp, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $score = 10 }
    elseif ($exp.IndexOf($t, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $t.Length -ge 4) { $score = 5 }
  }
  if ($score -gt $bestScore) { $bestScore = $score; $best = $p }
}
if (-not $best) { Write-Output 'NO_WINDOW'; exit 2 }
$hwnd = $best.MainWindowHandle
if ([EvCap]::IsIconic($hwnd)) { [EvCap]::ShowWindow($hwnd, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
[EvCap]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 200
$r = New-Object RECT
[EvCap]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Output 'BAD_RECT'; exit 3 }
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = $false
try { $ok = [EvCap]::PrintWindow($hwnd, $hdc, 2) } catch { $ok = $false }
$g.ReleaseHdc($hdc)
$saved = $false
if ($ok) {
  try { $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png); $saved = $true } catch {}
}
if (-not $saved) {
  # 回退：屏幕区域截图（窗口必须可见在前台）
  Add-Type -AssemblyName System.Windows.Forms
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $left = [Math]::Max($r.Left, $vs.Left)
  $top = [Math]::Max($r.Top, $vs.Top)
  $right = [Math]::Min($r.Right, $vs.Right)
  $bottom = [Math]::Min($r.Bottom, $vs.Bottom)
  $cw = $right - $left
  $ch = $bottom - $top
  if ($cw -gt 0 -and $ch -gt 0) {
    $bmp2 = New-Object System.Drawing.Bitmap($cw, $ch)
    $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
    $g2.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($cw, $ch)))
    $bmp2.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g2.Dispose(); $bmp2.Dispose()
    $saved = $true
  }
}
$g.Dispose(); $bmp.Dispose()
if (-not $saved) { Write-Output 'SAVE_FAIL'; exit 4 }
Write-Output ("OK " + $best.MainWindowTitle)
