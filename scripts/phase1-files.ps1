param([string]$RollbackArchive = 'F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\phase1-pre-change-20261006-200248.zip')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$evidencePath = Join-Path $workspacePath 'docs/phase1/file-changes.json'
if (-not (Test-Path -LiteralPath $evidencePath)) { '{}' | Set-Content -LiteralPath $evidencePath }
$archive = [System.IO.Compression.ZipFile]::OpenRead($RollbackArchive)
$originalPaths = @{}
$changed = @()
$removed = @()
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    $path = $entry.FullName.Replace('\','/')
    $stream = $entry.Open()
    try { $hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream)) }
    finally { $stream.Dispose() }
    $originalPaths[$path] = $hash
    $target = Join-Path $workspacePath $path
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { $removed += $path; continue }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { $changed += $path }
  }
} finally { $archive.Dispose() }
$currentPaths = & rg --files --hidden --no-ignore -g '!**/node_modules/**' -g '!**/.next/**' -g '!**/dist/**' -g '!test-results/**' -g '!playwright-report/**' -g '!.git/**' -g '!**/*.tsbuildinfo' $workspacePath
if ($LASTEXITCODE -ne 0) { throw 'File inventory failed' }
$created = @($currentPaths | ForEach-Object { [System.IO.Path]::GetRelativePath($workspacePath,$_).Replace('\','/') } | Where-Object { -not $originalPaths.ContainsKey($_) } | Sort-Object)
$phase0Drift = @($changed + $removed + $created | Where-Object { $_.StartsWith('docs/phase0/') })
$historicalSqlDrift = @($changed + $removed | Where-Object { $_.StartsWith('supabase/migrations/') -and $_.EndsWith('.sql') })
if ($phase0Drift.Count -or $historicalSqlDrift.Count) { throw 'Immutable baseline or historical SQL changed' }
$result = [ordered]@{
  rollbackArchive = $RollbackArchive
  rollbackSHA256 = (Get-FileHash -LiteralPath $RollbackArchive -Algorithm SHA256).Hash
  changed = @($changed | Sort-Object)
  implementationChanged = @($changed | Where-Object { $_ -ne '.env.example' -and -not $_.EndsWith('.tsbuildinfo') } | Sort-Object)
  unattributedConfigurationDrift = @($changed | Where-Object { $_ -eq '.env.example' })
  generatedCacheChanges = @($changed | Where-Object { $_.EndsWith('.tsbuildinfo') })
  created = $created
  removed = $removed
  phase0EvidenceUnchanged = $true
  historicalSqlUnchanged = $true
  phase0ManifestSHA256 = (Get-FileHash -LiteralPath (Join-Path $workspacePath 'docs/phase0/source-manifest.json')).Hash
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath
Write-Output "$($changed.Count) changed, $($created.Count) created, $($removed.Count) removed; Phase 0 evidence and historical SQL unchanged"
