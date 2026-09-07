[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [string]$DataRoot,

    [Parameter(Mandatory = $true)]
    [ValidateSet('existing', 'download')]
    [string]$ModelMode,

    [string]$ModelPath,

    [Parameter(Mandatory = $true)]
    [string]$RequirementsPath,

    [string]$CacheRoot = (Join-Path $env:TEMP 'FR-SAM-Text-Selection-0.9.1'),

    [string]$LogPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$systemModulePath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
if ([string]::IsNullOrWhiteSpace($env:PSModulePath)) {
    $env:PSModulePath = $systemModulePath
} elseif (($env:PSModulePath -split ';') -notcontains $systemModulePath) {
    $env:PSModulePath = $systemModulePath + ';' + $env:PSModulePath
}
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
Import-Module Microsoft.PowerShell.Archive -ErrorAction Stop
if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    $logParent = Split-Path -Parent $LogPath
    New-Item -ItemType Directory -Path $logParent -Force | Out-Null
    Start-Transcript -LiteralPath $LogPath -Force | Out-Null
}

$PythonUrl = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip'
$PythonSha256 = '608619F8619075629C9C69F361352A0DA6ED7E62F83A0E19C63E0EA32EB7629D'
$PipUrl = 'https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl'
$PipSha256 = '9655943313A94722B7774661C21049070F6BBB0A1516BF02F7C8D5D9201514CD'
$ModelUrl = 'https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors'
$ModelSha256 = '9BA99C92703C2E8B4F47DE2D34A539BB8E18923049E238B780D70DBE6368EB03'
$TorchIndex = 'https://download.pytorch.org/whl/cu128'
$PyPiIndex = 'https://pypi.org/simple'

function Write-Stage([string]$Message) {
    Write-Output "[FR SAM] $Message"
}

function Assert-PathText([string]$Value, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\r\n\"%!\^&|<>]') {
        throw "$Label contains unsupported command characters."
    }
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$Sha256) {
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $existing = Get-Sha256 $Destination
        if ($existing -eq $Sha256) {
            return
        }
        Remove-Item -LiteralPath $Destination -Force
    }
    $partial = "$Destination.partial"
    if (Test-Path -LiteralPath $partial) {
        Remove-Item -LiteralPath $partial -Force
    }
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 60
    $actual = Get-Sha256 $partial
    if ($actual -ne $Sha256) {
        Remove-Item -LiteralPath $partial -Force
        throw "Downloaded file hash mismatch: $Destination"
    }
    Move-Item -LiteralPath $partial -Destination $Destination
}

function Assert-SafeChild([string]$Root, [string]$Candidate) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidateFull = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidateFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the install root: $candidateFull"
    }
}

function Remove-SafeChild([string]$Root, [string]$Candidate) {
    Assert-SafeChild $Root $Candidate
    if (Test-Path -LiteralPath $Candidate) {
        Remove-Item -LiteralPath $Candidate -Recurse -Force
    }
}

function Invoke-Pip([string]$Python, [string]$PipWheel, [string[]]$Arguments) {
    $previousWheel = $env:FR_SAM_PIP_WHEEL
    $previousArgs = $env:FR_SAM_PIP_ARGS
    $bootstrap = Join-Path (Split-Path -Parent $Python) 'fr_sam_pip_bootstrap.py'
    try {
        $env:FR_SAM_PIP_WHEEL = $PipWheel
        $env:FR_SAM_PIP_ARGS = ConvertTo-Json -Compress -InputObject $Arguments
        $code = @(
            'import json, os, sys'
            'sys.path.insert(0, os.environ["FR_SAM_PIP_WHEEL"])'
            'from pip._internal.cli.main import main'
            'raise SystemExit(main(json.loads(os.environ["FR_SAM_PIP_ARGS"])))'
        ) -join [Environment]::NewLine
        [IO.File]::WriteAllText($bootstrap, $code + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        & $Python $bootstrap
        if ($LASTEXITCODE -ne 0) {
            throw "pip exited with code $LASTEXITCODE"
        }
    } finally {
        Remove-Item -LiteralPath $bootstrap -Force -ErrorAction SilentlyContinue
        if ($null -eq $previousWheel) { Remove-Item Env:FR_SAM_PIP_WHEEL -ErrorAction SilentlyContinue }
        else { $env:FR_SAM_PIP_WHEEL = $previousWheel }
        if ($null -eq $previousArgs) { Remove-Item Env:FR_SAM_PIP_ARGS -ErrorAction SilentlyContinue }
        else { $env:FR_SAM_PIP_ARGS = $previousArgs }
    }
}

Assert-PathText $InstallRoot 'InstallRoot'
Assert-PathText $DataRoot 'DataRoot'
Assert-PathText $RequirementsPath 'RequirementsPath'
if (-not (Test-Path -LiteralPath $RequirementsPath -PathType Leaf)) {
    throw 'The pinned runtime requirements file is missing.'
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
New-Item -ItemType Directory -Path $InstallRoot, $DataRoot, $CacheRoot -Force | Out-Null

$pythonArchive = Join-Path $CacheRoot 'python-3.10.11-embed-amd64.zip'
$pipWheel = Join-Path $CacheRoot 'pip-25.3-py3-none-any.whl'
Write-Stage 'Downloading and verifying CPython and pip.'
Get-VerifiedFile $PythonUrl $pythonArchive $PythonSha256
Get-VerifiedFile $PipUrl $pipWheel $PipSha256

$runtime = Join-Path $InstallRoot 'runtime'
$runtimeStage = Join-Path $InstallRoot 'runtime.new'
$runtimePrevious = Join-Path $InstallRoot 'runtime.previous'
if (
    -not (Test-Path -LiteralPath (Join-Path $runtimeStage 'python.exe') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $runtime 'python.exe') -PathType Leaf)
) {
    # Never move the working runtime out from under an installed plugin before
    # downloads and validation succeed. A failed upgrade must leave it usable.
    Assert-SafeChild $InstallRoot $runtime
    Assert-SafeChild $InstallRoot $runtimeStage
    Copy-Item -LiteralPath $runtime -Destination $runtimeStage -Recurse -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeStage 'python.exe') -PathType Leaf)) {
    Remove-SafeChild $InstallRoot $runtimeStage
    New-Item -ItemType Directory -Path $runtimeStage -Force | Out-Null
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $runtimeStage -Force
}

$pthPath = Join-Path $runtimeStage 'python310._pth'
$pth = [IO.File]::ReadAllText($pthPath)
$pth = $pth.Replace('#import site', 'import site')
foreach ($entry in @('Lib\site-packages', '..\backend')) {
    if (-not (($pth -split '\r?\n') -contains $entry)) {
        $pth = $pth.TrimEnd() + [Environment]::NewLine + $entry + [Environment]::NewLine
    }
}
[IO.File]::WriteAllText($pthPath, $pth, [Text.UTF8Encoding]::new($false))
$sitePackages = Join-Path $runtimeStage 'Lib\site-packages'
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
$python = Join-Path $runtimeStage 'python.exe'

$torchVersionFile = Join-Path $sitePackages 'torch\version.py'
$torchvisionVersionFile = Join-Path $sitePackages 'torchvision\version.py'
$torchReady =
    (Test-Path -LiteralPath $torchVersionFile) -and (Select-String -LiteralPath $torchVersionFile -Quiet -Pattern '2\.10\.0\+cu128') -and
    (Test-Path -LiteralPath $torchvisionVersionFile) -and (Select-String -LiteralPath $torchvisionVersionFile -Quiet -Pattern '0\.25\.0\+cu128')
if (-not $torchReady) {
    Write-Stage 'Installing pinned PyTorch 2.10 / CUDA 12.8 wheels.'
    Invoke-Pip $python $pipWheel @(
        'install', '--upgrade', '--disable-pip-version-check', '--only-binary=:all:',
        '--no-deps', '--target', $sitePackages, '--index-url', $TorchIndex,
        'torch==2.10.0+cu128', 'torchvision==0.25.0+cu128'
    )
} else {
    Write-Stage 'Reusing the verified staged PyTorch runtime.'
}

Write-Stage 'Installing the pinned inference dependency set.'
Invoke-Pip $python $pipWheel @(
    'install', '--upgrade', '--disable-pip-version-check', '--no-cache-dir', '--only-binary=:all:',
    '--no-deps', '--target', $sitePackages, '--index-url', $PyPiIndex,
    '--requirement', $RequirementsPath
)

$verifyCode = @'
import json
import torch
import torchvision
import numpy
import PIL
import safetensors
import timm
import triton
assert torch.__version__ == "2.10.0+cu128", torch.__version__
assert torchvision.__version__ == "0.25.0+cu128", torchvision.__version__
assert torch.version.cuda == "12.8", torch.version.cuda
print(json.dumps({"torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda}))
'@
$verifyScript = Join-Path $runtimeStage 'fr_sam_verify_runtime.py'
try {
    [IO.File]::WriteAllText(
        $verifyScript,
        $verifyCode + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    & $python $verifyScript
    if ($LASTEXITCODE -ne 0) {
        throw 'The pinned Python runtime import test failed.'
    }
} finally {
    Remove-Item -LiteralPath $verifyScript -Force -ErrorAction SilentlyContinue
}

$modelDirectory = Join-Path $DataRoot 'Models'
New-Item -ItemType Directory -Path $modelDirectory -Force | Out-Null
$downloadMarker = Join-Path $DataRoot 'downloaded-model.marker'
if ($ModelMode -eq 'download') {
    $resolvedModel = Join-Path $modelDirectory 'sam3.1_multiplex_fp16.safetensors'
    Write-Stage 'Downloading and verifying the SAM 3.1 model.'
    Get-VerifiedFile $ModelUrl $resolvedModel $ModelSha256
    [IO.File]::WriteAllText($downloadMarker, 'downloaded-by=0.9.2' + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
} else {
    Assert-PathText $ModelPath 'ModelPath'
    $resolvedModel = (Resolve-Path -LiteralPath $ModelPath).Path
    $actualModelHash = Get-Sha256 $resolvedModel
    if ($actualModelHash -ne $ModelSha256) {
        throw 'The selected SAM 3.1 model file has an unsupported SHA-256 hash.'
    }
    if (Test-Path -LiteralPath $downloadMarker) {
        Remove-Item -LiteralPath $downloadMarker -Force
    }
}

$configPath = Join-Path $DataRoot 'runtime-v2.ini'
$config = @(
    '# Generated by FR SAM Text Selection 0.9.2 installer'
    'schemaVersion=2'
    "installRoot=$InstallRoot"
    'python=runtime\python.exe'
    'backend=backend'
    "model=$resolvedModel"
    'officialSam3=vendor\sam3'
) -join [Environment]::NewLine
Write-Stage 'Running the offline runtime preflight.'
$previousOffline = $env:HF_HUB_OFFLINE
try {
    $env:HF_HUB_OFFLINE = '1'
    Push-Location (Join-Path $InstallRoot 'backend')
    try {
        & $python -m sam31_backend.preflight --model $resolvedModel --official-sam3-root (Join-Path $InstallRoot 'vendor\sam3')
        if ($LASTEXITCODE -ne 0) {
            throw 'The offline runtime preflight failed.'
        }
    } finally {
        Pop-Location
    }
} finally {
    if ($null -eq $previousOffline) { Remove-Item Env:HF_HUB_OFFLINE -ErrorAction SilentlyContinue }
    else { $env:HF_HUB_OFFLINE = $previousOffline }
}

# Commit only after the staged runtime, model and offline preflight all pass.
Remove-SafeChild $InstallRoot $runtimePrevious
Assert-SafeChild $InstallRoot $runtime
Assert-SafeChild $InstallRoot $runtimeStage
if (Test-Path -LiteralPath $runtime) {
    Move-Item -LiteralPath $runtime -Destination $runtimePrevious
}
try {
    Move-Item -LiteralPath $runtimeStage -Destination $runtime
} catch {
    if ((Test-Path -LiteralPath $runtimePrevious) -and -not (Test-Path -LiteralPath $runtime)) {
        Move-Item -LiteralPath $runtimePrevious -Destination $runtime
    }
    throw
}
$configPartial = $configPath + '.partial'
[IO.File]::WriteAllText($configPartial, $config + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
if (Test-Path -LiteralPath $configPath) { [IO.File]::Replace($configPartial, $configPath, $configPath + '.previous') }
else { [IO.File]::Move($configPartial, $configPath) }
Remove-SafeChild $InstallRoot $runtimePrevious
Write-Stage 'Online setup complete; installed inference is now fully offline.'
if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    Stop-Transcript | Out-Null
    Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue
}
