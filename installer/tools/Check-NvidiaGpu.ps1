[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$candidates = @(
    (Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    (Join-Path $env:ProgramW6432 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'),
    (Join-Path $env:SystemRoot 'System32\nvidia-smi.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique

if (-not $candidates) {
    Write-Error 'NVIDIA driver or nvidia-smi was not detected.'
    exit 10
}

$values = & $candidates[0] '--query-gpu=memory.total' '--format=csv,noheader,nounits' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error ('Could not query the NVIDIA GPU: ' + ($values -join ' '))
    exit 11
}
$memory = @($values | ForEach-Object {
    $parsed = 0
    if ([int]::TryParse(($_ -replace '[^0-9]', ''), [ref]$parsed)) { $parsed }
})
if (-not $memory) {
    Write-Error 'Could not read NVIDIA GPU memory capacity.'
    exit 12
}
$maximumMiB = ($memory | Measure-Object -Maximum).Maximum
if ($maximumMiB -lt 15360) {
    Write-Error ("The largest NVIDIA GPU reports only $maximumMiB MiB; 16 GB class is required.")
    exit 13
}
Write-Output "NVIDIA GPU prerequisite passed: $maximumMiB MiB"
exit 0
