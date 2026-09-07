[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CcxPath,
    [string]$ExpectedVersion = '0.9.2',
    [string]$StagedPluginRoot,
    [string]$InstalledPluginRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $CcxPath).Path)
try {
    $entry = $archive.GetEntry('manifest.json')
    if (-not $entry) { throw 'CCX has no manifest.json.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.id -ne 'com.fangrui.sam-selection' -or $manifest.version -ne $ExpectedVersion -or
        $manifest.requiredPermissions.enableAddon -ne $true -or
        $manifest.requiredPermissions.localFileSystem -ne 'fullAccess') {
        throw 'CCX identity, version or required filesystem permission is incorrect.'
    }
    foreach ($root in @($StagedPluginRoot, $InstalledPluginRoot)) {
        if (-not $root) { continue }
        $rootFull = (Resolve-Path -LiteralPath $root).Path.TrimEnd('\') + '\'
        foreach ($file in $archive.Entries) {
            if (-not $file.Name) { continue }
            $target = [IO.Path]::GetFullPath((Join-Path $rootFull $file.FullName))
            if (-not $target.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe CCX entry.' }
            if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing installed/staged file: $target" }
            if ($file.FullName -eq 'manifest.json') {
                $actual = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
                # UPIA may rewrite whitespace; compare canonical JSON instead.
                if (($actual | ConvertTo-Json -Depth 30 -Compress) -ne ($manifest | ConvertTo-Json -Depth 30 -Compress)) {
                    throw "Manifest differs from the CCX: $target"
                }
            } else {
                $stream = $file.Open()
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $expected = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
                finally { $sha.Dispose(); $stream.Dispose() }
                if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected) {
                    throw "File differs from the CCX: $target"
                }
            }
        }
    }
    Write-Output "PASS: CCX $ExpectedVersion permissions and supplied installed/staged directories match."
} finally { $archive.Dispose() }
