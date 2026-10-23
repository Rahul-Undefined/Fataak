# Builds resources/icon.png (256), resources/tray.png (32) and resources/icon.ico (16/24/32/48/64/128/256)
# from resources/logo.png using only .NET System.Drawing (no npm image packages needed).
param([string]$Source = "resources/logo.png")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root $Source
if (-not (Test-Path $src)) { throw "logo not found: $src" }
$logo = [System.Drawing.Image]::FromFile($src)

function Resize([System.Drawing.Image]$img, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}
function PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  # the leading comma stops PowerShell unrolling the byte[] into the pipeline
  return ,$ms.ToArray()
}

$res = Join-Path $root 'resources'
(Resize $logo 256).Save((Join-Path $res 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
(Resize $logo 32).Save((Join-Path $res 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# ICO container with PNG-compressed entries (supported since Windows Vista)
$sizes = 16, 24, 32, 48, 64, 128, 256
$entries = New-Object System.Collections.ArrayList
foreach ($s in $sizes) { [void]$entries.Add([byte[]](PngBytes (Resize $logo $s))) }
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; [byte[]]$b = $entries[$i]
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$b.Length); $bw.Write([uint32]$offset)
  $offset += $b.Length
}
foreach ($e in $entries) { [byte[]]$b = $e; $bw.Write($b, 0, $b.Length) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $res 'icon.ico'), $ms.ToArray())
$logo.Dispose()
"icons written: icon.png, tray.png, icon.ico ($($sizes -join '/'))"
