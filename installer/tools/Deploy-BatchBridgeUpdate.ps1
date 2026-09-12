[CmdletBinding()]
param([string]$PhotoshopRoot = 'C:\Program Files\Adobe\Adobe Photoshop 2026', [switch]$UserScriptsOnly, [switch]$Log)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($Log) { Start-Transcript -Path (Join-Path $repo 'work\bridge-update-install.log') -Force | Out-Null }
$configFile = Join-Path $env:LOCALAPPDATA 'FR\FR SAM Text Selection\runtime-v2.ini'
$config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8
$match = [regex]::Match($config, '(?m)^installRoot=(.+)$')
if (-not $match.Success) { throw 'Installed runtime config is missing installRoot.' }
$install = $match.Groups[1].Value.Trim()
if (-not [IO.Path]::IsPathRooted($install) -or -not (Test-Path -LiteralPath $install -PathType Container)) { throw 'Invalid install root.' }
$source = Get-Content -LiteralPath (Join-Path $repo 'legacy\SAM31 Image Processor Bridge.jsx') -Raw -Encoding UTF8
if ($source -notmatch 'function runLocalBridge' -or $source -match 'app\.system\(') { throw 'Unrecognized bridge update.' }
$scripts = Join-Path $env:APPDATA 'Adobe\Adobe Photoshop 2026\Presets\Scripts'
$targets = @(
    (Join-Path $scripts 'FR SAM Text Selection Image Processor.jsx'),
    (Join-Path $scripts 'SAM31 Image Processor Bridge.jsx'),
    (Join-Path $PhotoshopRoot 'Presets\Scripts\SAM31 Image Processor Bridge.jsx')
)
if ($UserScriptsOnly) { $targets = $targets[0..1] }
# Check all required write handles before changing any script. No ACL changes.
foreach ($target in $targets) {
    $handle = [IO.File]::Open($target, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $handle.Dispose()
}
$backup = Join-Path $repo ('work\bridge-update-backup-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds())
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
for ($i = 0; $i -lt $targets.Count; $i++) {
    if (-not (Test-Path -LiteralPath $targets[$i] -PathType Leaf)) { throw "Expected installed script missing: $($targets[$i])" }
    Copy-Item -LiteralPath $targets[$i] -Destination (Join-Path $backup "script-$i.jsx.backup")
}
$launcher = Join-Path $install 'bin\fr-sam-legacy-launcher.exe'
if (Test-Path -LiteralPath $launcher) { Copy-Item -LiteralPath $launcher -Destination (Join-Path $backup 'launcher.exe.backup') }
New-Item -ItemType Directory -Path (Split-Path $launcher -Parent) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'native\build-release\Release\fr-sam-legacy-launcher.exe') -Destination $launcher -Force
$compat = $source.Replace('frSamImageProcessorBridge', 'sam31ImageProcessorBridge').Replace('<name>FR SAM 文本选区（图像处理器）</name>', '<name>SAM 3.1 图像处理器桥接</name>')
$written = @()
try {
    for ($i = 0; $i -lt $targets.Count; $i++) {
        $text = if ($i -eq 0) { $source } else { $compat }
        [IO.File]::WriteAllText($targets[$i], $text, [Text.UTF8Encoding]::new($true))
        $written += $i
        if ([IO.File]::ReadAllText($targets[$i]) -ne $text) { throw "Deployed script mismatch: $($targets[$i])" }
    }
} catch {
    foreach ($index in $written) { Copy-Item -LiteralPath (Join-Path $backup "script-$index.jsx.backup") -Destination $targets[$index] -Force }
    throw
}
Write-Output "DEPLOYED: $($targets.Count) bridge scripts + silent launcher. BACKUP=$backup"
if ($Log) { Stop-Transcript | Out-Null }
