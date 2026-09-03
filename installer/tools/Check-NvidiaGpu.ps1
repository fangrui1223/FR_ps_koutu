[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$candidates = @(
    (Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    (Join-Path $env:ProgramW6432 'NVIDIA Corporation\NVSMI\nvidia-smi.exe'),
    (Join-Path $env:SystemRoot 'System32\nvidia-smi.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique

if (-not $candidates) {
    Write-Error '未检测到 NVIDIA 驱动或 nvidia-smi。此插件要求 NVIDIA GPU 和正常安装的驱动。'
    exit 10
}

$values = & $candidates[0] '--query-gpu=memory.total' '--format=csv,noheader,nounits' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error ('无法查询 NVIDIA GPU：' + ($values -join ' '))
    exit 11
}
$memory = @($values | ForEach-Object {
    $parsed = 0
    if ([int]::TryParse(($_ -replace '[^0-9]', ''), [ref]$parsed)) { $parsed }
})
if (-not $memory) {
    Write-Error '无法读取 NVIDIA GPU 显存容量。'
    exit 12
}
$maximumMiB = ($memory | Measure-Object -Maximum).Maximum
if ($maximumMiB -lt 15360) {
    Write-Error ("最大 NVIDIA GPU 仅报告 $maximumMiB MiB；此插件要求 16 GB 级显卡。")
    exit 13
}
Write-Output "NVIDIA GPU prerequisite passed: $maximumMiB MiB"
exit 0
