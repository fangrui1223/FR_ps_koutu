Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$report = Join-Path $repo 'work\batch-focus-observation.txt'
$output = Join-Path $repo 'work\batch-ui-process-observation.json'
$photoshop = Get-Process Photoshop
$related = [Collections.Generic.HashSet[int]]::new()
[void]$related.Add($photoshop.Id)
$seen = @{}
$titles = [Collections.Generic.List[string]]::new()
$watch = [Diagnostics.Stopwatch]::StartNew()
while ($watch.Elapsed.TotalSeconds -lt 240) {
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='cmd.exe' OR Name='python.exe' OR Name='fr-sam-legacy-launcher.exe'")) {
        if ($process.Name -eq 'fr-sam-legacy-launcher.exe' -or $related.Contains([int]$process.ParentProcessId)) {
            [void]$related.Add([int]$process.ProcessId)
            $seen[$process.ProcessId] = [pscustomobject]@{name=$process.Name;pid=$process.ProcessId;parent=$process.ParentProcessId}
        }
    }
    $photoshop.Refresh()
    $title = $photoshop.MainWindowTitle
    if ($titles.Count -eq 0 -or $titles[$titles.Count - 1] -ne $title) { $titles.Add($title) }
    if ((Test-Path -LiteralPath $report) -and (Get-Content -LiteralPath $report -Raw) -match '(?m)^END=') { break }
    Start-Sleep -Milliseconds 150
}
[ordered]@{seconds=$watch.Elapsed.TotalSeconds; processes=@($seen.Values); titles=@($titles.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $output -Encoding utf8
Write-Output "REPORT=$output"
$seen.Values | Group-Object name | Select-Object Name,Count
