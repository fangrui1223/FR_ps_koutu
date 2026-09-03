[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$RuntimePython,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$HybridSdkRoot,

    [string]$PluginId = 'com.fr.sam31-selection.dev',
    [string]$Version = '0.1.0',
    [switch]$PublicRelease,
    [switch]$ReuseStagedRuntime,
    [switch]$SkipRuntime,
    [switch]$SkipNativeBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path $PSScriptRoot 'stage'
$payloadRoot = Join-Path $stageRoot 'payload'
$pluginRoot = Join-Path $stageRoot 'plugin'
$releaseBuild = Join-Path $projectRoot 'native\build-release'

if ($PublicRelease -and $PluginId.EndsWith('.dev')) {
    throw 'PublicRelease requires the final Adobe Developer Distribution plugin ID, not a .dev ID.'
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Version must contain exactly three numeric components.'
}

if ((Test-Path -LiteralPath $stageRoot) -and -not $ReuseStagedRuntime) {
    $resolvedStage = (Resolve-Path -LiteralPath $stageRoot).Path
    $resolvedInstaller = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    if (-not $resolvedStage.StartsWith($resolvedInstaller + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean a staging path outside installer/.'
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadRoot, $pluginRoot -Force | Out-Null

if ($ReuseStagedRuntime -and -not (Test-Path -LiteralPath (Join-Path $payloadRoot 'runtime\python.exe') -PathType Leaf)) {
    throw 'ReuseStagedRuntime was requested, but the staged Python runtime is incomplete.'
}

if (-not $SkipRuntime -and -not $ReuseStagedRuntime) {
    $runtimeOutput = Join-Path $payloadRoot 'runtime'
    $runtimeManifest = Join-Path $payloadRoot 'licenses\python-runtime-manifest.json'
    $pythonLicenses = Join-Path $payloadRoot 'licenses\python'
    & $RuntimePython (Join-Path $PSScriptRoot 'tools\stage_runtime.py') `
        --output $runtimeOutput --manifest $runtimeManifest --licenses $pythonLicenses
    if ($LASTEXITCODE -ne 0) { throw 'Standalone Python runtime staging failed.' }
}

$backendTarget = Join-Path $payloadRoot 'backend\sam31_backend'
New-Item -ItemType Directory -Path $backendTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'backend\sam31_backend') -Filter '*.py' -File |
    Copy-Item -Destination $backendTarget -Force

$modelTarget = Join-Path $payloadRoot 'models'
New-Item -ItemType Directory -Path $modelTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'models\sam3.1_multiplex_fp16.safetensors') -Destination $modelTarget -Force

$sam3Target = Join-Path $payloadRoot 'vendor\sam3'
$sam3PackageTarget = Join-Path $sam3Target 'sam3'
New-Item -ItemType Directory -Path $sam3PackageTarget -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'work\sam3-official\sam3') -Force |
    Copy-Item -Destination $sam3PackageTarget -Recurse -Force
Get-ChildItem -LiteralPath $sam3Target -Directory -Filter '__pycache__' -Recurse -Force |
    Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $sam3Target -File -Filter '*.pyc' -Recurse -Force |
    Remove-Item -Force
$licenseRoot = Join-Path $payloadRoot 'licenses'
New-Item -ItemType Directory -Path $licenseRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'work\sam3-official\LICENSE') -Destination (Join-Path $licenseRoot 'SAM-LICENSE.txt') -Force

$scriptTarget = Join-Path $payloadRoot 'scripts\SAM31 Image Processor Bridge.jsx'
New-Item -ItemType Directory -Path (Split-Path -Parent $scriptTarget) -Force | Out-Null
$script = Get-Content -LiteralPath (Join-Path $projectRoot 'legacy\SAM31 Image Processor Bridge.jsx') -Raw
$releaseScript = $script.Replace(
    'var ALLOW_DEV_FALLBACK = true; // @sam31-release-dev-fallback',
    'var ALLOW_DEV_FALLBACK = false; // @sam31-release-dev-fallback'
)
if ($releaseScript -eq $script) { throw 'The ExtendScript release marker was not found.' }
$releaseScriptWithoutDevPaths = [regex]::Replace(
    $releaseScript,
    '(?s)\s*// @sam31-dev-runtime-begin.*?// @sam31-dev-runtime-end',
    "`r`n    var DEV_RUNTIME = null;"
)
if ($releaseScriptWithoutDevPaths -eq $releaseScript) { throw 'The ExtendScript development runtime block was not found.' }
$releaseScript = $releaseScriptWithoutDevPaths
if ($releaseScript -match 'C:/FR_comfyui|D:/FR_AI') { throw 'A development path remains in the release ExtendScript.' }
[System.IO.File]::WriteAllText($scriptTarget, $releaseScript, [System.Text.UTF8Encoding]::new($false))

if (-not $SkipNativeBuild) {
    $cmake = Get-Command 'cmake.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
    if (-not $cmake) {
        $cmake = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    }
    if (-not (Test-Path -LiteralPath $cmake -PathType Leaf)) { throw 'CMake was not found.' }
    & $cmake -S (Join-Path $projectRoot 'native') -B $releaseBuild -A x64 `
        "-DUXP_HYBRID_SDK_ROOT=$HybridSdkRoot" `
        '-DSAM31_BACKEND_MOCK_ALPHA=OFF' '-DSAM31_ALLOW_DEV_FALLBACK=OFF' '-DBUILD_TESTING=ON'
    if ($LASTEXITCODE -ne 0) { throw 'Release native configure failed.' }
    & $cmake --build $releaseBuild --config Release
    if ($LASTEXITCODE -ne 0) { throw 'Release native build failed.' }
    & (Join-Path $releaseBuild 'Release\sam31_runtime_config_tests.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Release runtime configuration tests failed.' }
}

if (-not $SkipRuntime) {
    Push-Location (Join-Path $payloadRoot 'backend')
    $previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
    try {
        $env:PYTHONDONTWRITEBYTECODE = '1'
        & (Join-Path $payloadRoot 'runtime\python.exe') -m sam31_backend.preflight `
            --model (Join-Path $payloadRoot 'models\sam3.1_multiplex_fp16.safetensors') `
            --official-sam3-root (Join-Path $payloadRoot 'vendor\sam3')
        if ($LASTEXITCODE -ne 0) { throw 'Staged standalone runtime preflight failed.' }
    } finally {
        if ($null -eq $previousDontWriteBytecode) {
            Remove-Item Env:PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
        } else {
            $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
        }
        Pop-Location
    }
}

$pluginFiles = @('index.html', 'index.js', 'styles.css')
foreach ($name in $pluginFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "plugin\$name") -Destination $pluginRoot -Force
}
$pluginLib = Join-Path $pluginRoot 'lib'
New-Item -ItemType Directory -Path $pluginLib -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'plugin\lib') -Force |
    Copy-Item -Destination $pluginLib -Recurse -Force
$pluginIcons = Join-Path $pluginRoot 'icons'
New-Item -ItemType Directory -Path $pluginIcons -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'plugin\icons') -Filter '*.png' -File |
    Copy-Item -Destination $pluginIcons -Force
$addonTarget = Join-Path $pluginRoot 'win\x64'
New-Item -ItemType Directory -Path $addonTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $releaseBuild 'Release\sam31-supervisor.uxpaddon') -Destination $addonTarget -Force

$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'plugin\manifest.json') -Raw | ConvertFrom-Json
$manifest.id = $PluginId
$manifest.version = $Version
$manifestText = ($manifest | ConvertTo-Json -Depth 20).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText(
    (Join-Path $pluginRoot 'manifest.json'),
    $manifestText,
    [System.Text.UTF8Encoding]::new($false)
)

$releaseManifestPath = Join-Path $stageRoot 'release-manifest.json'
$hashes = Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
    Where-Object { $_.FullName -ne $releaseManifestPath } |
    Sort-Object FullName | ForEach-Object {
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
    generatedUtc = [DateTime]::UtcNow.ToString('o')
    files = $hashes
} | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText(
    $releaseManifestPath,
    $releaseManifest + "`r`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Release staging complete: $stageRoot"
Write-Output 'Package installer/stage/plugin with Adobe UXP Developer Tool to produce the official .ccx.'
Write-Output 'Compile installer/SAM31PhotoshopSelection.iss with Inno Setup after reviewing licenses and signing settings.'
