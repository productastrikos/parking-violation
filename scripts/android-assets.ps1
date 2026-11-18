# Launcher icons and splash screens for the Android app, from public/icons (Windows PowerShell, System.Drawing).
# Run after `npx cap add android`:  powershell -ExecutionPolicy Bypass -File scripts/android-assets.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root 'android\app\src\main\res'
$icon = Join-Path $root 'public\icons\icon-512.png'
$maskable = Join-Path $root 'public\icons\maskable-512.png'
$bg = [System.Drawing.ColorTranslator]::FromHtml('#121212')

function New-Png([string]$src, [string]$dst, [int]$w, [int]$h, [double]$logoFrac, [bool]$fill) {
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($fill) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }
    $s = [int]([Math]::Min($w, $h) * $logoFrac)
    $g.DrawImage($img, [int](($w - $s) / 2), [int](($h - $s) / 2), $s, $s)
    $g.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally { $img.Dispose() }
}

# Legacy + round launcher icons (square, full bleed) and the adaptive-icon foreground (108 dp canvas).
$dens = @{ 'mdpi' = 1.0; 'hdpi' = 1.5; 'xhdpi' = 2.0; 'xxhdpi' = 3.0; 'xxxhdpi' = 4.0 }
foreach ($d in $dens.Keys) {
  $dir = Join-Path $res "mipmap-$d"
  $px = [int](48 * $dens[$d]); $fg = [int](108 * $dens[$d])
  New-Png $icon (Join-Path $dir 'ic_launcher.png') $px $px 1.0 $true
  New-Png $icon (Join-Path $dir 'ic_launcher_round.png') $px $px 1.0 $true
  New-Png $maskable (Join-Path $dir 'ic_launcher_foreground.png') $fg $fg 1.0 $true
}
$bgXml = Join-Path $res 'values\ic_launcher_background.xml'
Set-Content -Encoding utf8 $bgXml '<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#121212</color>
</resources>'

# Splash screens: same sizes as the template files, dark background, logo in the middle.
Get-ChildItem $res -Recurse -Filter 'splash.png' | ForEach-Object {
  $probe = [System.Drawing.Image]::FromFile($_.FullName); $w = $probe.Width; $h = $probe.Height; $probe.Dispose()
  New-Png $maskable $_.FullName $w $h 0.42 $true
}
'icons and splash screens written'
