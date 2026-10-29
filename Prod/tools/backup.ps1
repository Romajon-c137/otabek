param([string]$Destination)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $projectRoot "backups" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path ([System.IO.Path]::GetFullPath($Destination)) $stamp
$mediaRoot = Join-Path $backupRoot "media"
New-Item -ItemType Directory -Path $mediaRoot -Force | Out-Null

Push-Location $projectRoot
try {
    docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=/tmp/hozuchet.dump'
    docker compose cp db:/tmp/hozuchet.dump (Join-Path $backupRoot "database.dump")
    docker compose exec -T db rm -f /tmp/hozuchet.dump
    docker compose cp backend:/app/media/. $mediaRoot
    $manifest = [ordered]@{
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        database = "database.dump"
        media = "media"
        project = "hozuchet-production-2"
    } | ConvertTo-Json
    Set-Content -LiteralPath (Join-Path $backupRoot "manifest.json") -Value $manifest -Encoding UTF8
    Write-Output "Backup created: $backupRoot"
}
finally { Pop-Location }

