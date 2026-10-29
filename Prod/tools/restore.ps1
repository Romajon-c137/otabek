param(
    [Parameter(Mandatory = $true)][string]$Backup,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = (Resolve-Path -LiteralPath $Backup).Path
$databaseDump = Join-Path $backupRoot "database.dump"
$mediaRoot = Join-Path $backupRoot "media"
if (-not (Test-Path -LiteralPath $databaseDump -PathType Leaf)) { throw "database.dump not found" }
if (-not (Test-Path -LiteralPath $mediaRoot -PathType Container)) { throw "media directory not found" }

if (-not $Force) {
    $answer = Read-Host "Restore will replace the current database and media. Type RESTORE"
    if ($answer -ne "RESTORE") { throw "Restore cancelled" }
}

Push-Location $projectRoot
try {
    docker compose stop backend
    docker compose cp $databaseDump db:/tmp/hozuchet.dump
    docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges /tmp/hozuchet.dump'
    docker compose exec -T db rm -f /tmp/hozuchet.dump
    docker compose run --rm --entrypoint sh backend -c 'find /app/media -mindepth 1 -delete'
    docker compose cp "$mediaRoot/." backend:/app/media
    docker compose up -d backend frontend
    docker compose exec -T backend python manage.py verify_ledgers
    Write-Output "Restore completed and ledgers verified."
}
finally { Pop-Location }

