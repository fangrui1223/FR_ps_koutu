[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$HybridSdkRoot,

    [string]$PluginId = 'com.fangrui.sam-selection',
    [string]$Version = '0.9.2',
    [switch]$SkipNativeBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path $PSScriptRoot 'stage'
$payloadRoot = Join-Path $stageRoot 'payload'
$pluginRoot = Join-Path $stageRoot 'plugin'
$releaseBuild = Join-Path $projectRoot 'native\build-release'
$expectedSamCommit = '660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7'

if ($PluginId -ne 'com.fangrui.sam-selection') {
    throw 'The public release must use com.fangrui.sam-selection.'
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Version must contain exactly three numeric components.'
}

if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStage = (Resolve-Path -LiteralPath $stageRoot).Path
    $resolvedInstaller = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    if (-not $resolvedStage.StartsWith($resolvedInstaller + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean a staging path outside installer/.'
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadRoot, $pluginRoot -Force | Out-Null

$backendTarget = Join-Path $payloadRoot 'backend\sam31_backend'
New-Item -ItemType Directory -Path $backendTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'backend\sam31_backend') -Filter '*.py' -File |
    Copy-Item -Destination $backendTarget -Force

$samSource = Join-Path $projectRoot 'work\sam3-official'
$actualSamCommit = (& git -C $samSource rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualSamCommit -ne $expectedSamCommit) {
    throw "Official SAM 3 source must be pinned to $expectedSamCommit."
}
$samTarget = Join-Path $payloadRoot 'vendor\sam3\sam3'
New-Item -ItemType Directory -Path $samTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $samSource 'sam3') -Force |
    Copy-Item -Destination $samTarget -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $payloadRoot 'vendor') -Directory -Filter '__pycache__' -Recurse -Force |
    Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $payloadRoot 'vendor') -File -Filter '*.pyc' -Recurse -Force |
    Remove-Item -Force

$licenseRoot = Join-Path $payloadRoot 'licenses'
New-Item -ItemType Directory -Path $licenseRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $licenseRoot 'FR-MIT-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $licenseRoot
Copy-Item -LiteralPath (Join-Path $samSource 'LICENSE') -Destination (Join-Path $licenseRoot 'SAM-LICENSE.txt')
$installNotice = @"
FR SAM Text Selection $Version

FR SAM source code is provided under the MIT License.

This installer also installs or downloads third-party components, including
Meta SAM 3.1, CPython, PyTorch, torchvision, triton-windows and other pinned
Python wheels. Those components remain under their own licenses. The complete
Meta SAM License and third-party notices are installed with the application.

The SAM license contains conditions and restrictions beyond a standard
open-source license. Continue only if you accept those terms.
"@
[IO.File]::WriteAllText(
    (Join-Path $licenseRoot 'INSTALL-NOTICE.txt'),
    $installNotice,
    [Text.UTF8Encoding]::new($false)
)

$scriptTarget = Join-Path $payloadRoot 'scripts\FR SAM Text Selection Image Processor.jsx'
New-Item -ItemType Directory -Path (Split-Path -Parent $scriptTarget) -Force | Out-Null
$script = Get-Content -LiteralPath (Join-Path $projectRoot 'legacy\SAM31 Image Processor Bridge.jsx') -Raw
$script = $script.Replace(
    'var ALLOW_DEV_FALLBACK = true; // Build marker: sam31-release-dev-fallback',
    'var ALLOW_DEV_FALLBACK = false; // Build marker: sam31-release-dev-fallback'
)
$script = [regex]::Replace(
    $script,
    '(?s)\s*// Build marker: sam31-dev-runtime-begin.*?// Build marker: sam31-dev-runtime-end',
    [Environment]::NewLine + '    var DEV_RUNTIME = null;'
)
if ($script -match 'C:/FR_comfyui|D:/FR_AI') {
    throw 'A development path remains in the release ExtendScript.'
}
if ($script -match '//\s*@sam31' -or $script -notmatch 'var ALLOW_DEV_FALLBACK = false;' -or $script -match 'var ALLOW_DEV_FALLBACK = true;') {
    throw 'Unsafe ExtendScript directive or development fallback in the release script.'
}
[IO.File]::WriteAllText($scriptTarget, $script, [Text.UTF8Encoding]::new($false))

$installerAssets = Join-Path $payloadRoot 'installer'
New-Item -ItemType Directory -Path $installerAssets -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tools\Install-OnlineRuntime.ps1') -Destination $installerAssets
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-requirements.txt') -Destination $installerAssets

if (-not $SkipNativeBuild) {
    $cmake = Get-Command 'cmake.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
    if (-not $cmake) {
        $cmake = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    }
    if (-not (Test-Path -LiteralPath $cmake -PathType Leaf)) {
        throw 'CMake was not found.'
    }
    $configureArgs = @(
        '-S', (Join-Path $projectRoot 'native'),
        '-B', $releaseBuild,
        '-A', 'x64',
        "-DUXP_HYBRID_SDK_ROOT=$HybridSdkRoot",
        '-DSAM31_BACKEND_MOCK_ALPHA=OFF',
        '-DSAM31_ALLOW_DEV_FALLBACK=OFF',
        '-DSAM31_BACKEND_PYTHON=',
        '-DSAM31_BACKEND_ROOT=',
        '-DSAM31_MODEL_CHECKPOINT=',
        '-DSAM31_OFFICIAL_SAM3_ROOT=',
        '-DBUILD_TESTING=ON'
    )
    & $cmake @configureArgs
    if ($LASTEXITCODE -ne 0) { throw 'Release native configure failed.' }
    & $cmake --build $releaseBuild --config Release
    if ($LASTEXITCODE -ne 0) { throw 'Release native build failed.' }
    & (Join-Path $releaseBuild 'Release\sam31_runtime_config_tests.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Release runtime configuration tests failed.' }
}

foreach ($name in @('index.html', 'index.js', 'styles.css')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "plugin\$name") -Destination $pluginRoot -Force
}
foreach ($directory in @('lib', 'icons')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "plugin\$directory") -Destination $pluginRoot -Recurse -Force
}
$addonTarget = Join-Path $pluginRoot 'win\x64'
New-Item -ItemType Directory -Path $addonTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $releaseBuild 'Release\sam31-supervisor.uxpaddon') -Destination $addonTarget -Force

$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'plugin\manifest.json') -Raw | ConvertFrom-Json
if ($manifest.requiredPermissions.enableAddon -ne $true -or
    $manifest.requiredPermissions.localFileSystem -ne 'fullAccess') {
    throw 'Hybrid release requires enableAddon AND localFileSystem: fullAccess. Refusing to package an inaccessible runtime.'
}
if ($manifest.version -ne $Version -or
    (Get-Content -LiteralPath (Join-Path $projectRoot 'installer\FRSAMTextSelection.iss') -Raw) -notmatch ('#define AppVersion "' + [regex]::Escape($Version) + '"') -or
    (Get-Content -LiteralPath (Join-Path $projectRoot 'backend\sam31_backend\__init__.py') -Raw) -notmatch ('BACKEND_VERSION = "' + [regex]::Escape($Version) + '"')) {
    throw 'Plugin, backend, installer and requested release versions must match.'
}
$manifest.id = $PluginId
$manifest.name = 'FR SAM 文本选区'
$manifest.version = $Version
$manifest.host.minVersion = '26.0.0'
$manifestText = ($manifest | ConvertTo-Json -Depth 20).Replace(
    [Environment]::NewLine,
    [string][char]10
)
[IO.File]::WriteAllText(
    (Join-Path $pluginRoot 'manifest.json'),
    $manifestText,
    [Text.UTF8Encoding]::new($false)
)

$releaseManifestPath = Join-Path $stageRoot 'release-manifest.json'
$hashes = Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
    Where-Object { $_.FullName -ne $releaseManifestPath } |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        }
    }
$releaseManifest = [pscustomobject]@{
    schemaVersion = 1
    pluginId = $PluginId
    version = $Version
    officialSam3Commit = $expectedSamCommit
    modelSha256 = '9BA99C92703C2E8B4F47DE2D34A539BB8E18923049E238B780D70DBE6368EB03'
    generatedUtc = [DateTime]::UtcNow.ToString('o')
    files = $hashes
} | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText(
    $releaseManifestPath,
    $releaseManifest + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

Write-Output "Public release staging complete: $stageRoot"
Write-Output 'Package installer/stage/plugin with Adobe UXP Developer Tool.'
Write-Output 'Compile installer/FRSAMTextSelection.iss with Inno Setup 6.'
