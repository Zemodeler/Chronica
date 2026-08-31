[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceName = "postgresql-x64-16"
$databaseService = Get-Service -Name $serviceName

if ($databaseService.Status -ne "Running") {
  Start-Service -Name $serviceName
  $databaseService.WaitForStatus("Running", [TimeSpan]::FromSeconds(15))
}

$environmentFile = Join-Path $projectRoot "apps\\web\\.env.local"
if (-not (Test-Path -LiteralPath $environmentFile)) {
  throw "Cannot find $environmentFile. Create it with a DATABASE_URL first."
}

$databaseUrlLine = Get-Content -LiteralPath $environmentFile |
  Where-Object { $_ -match "^DATABASE_URL\s*=" } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($databaseUrlLine)) {
  throw "DATABASE_URL is not set in $environmentFile."
}

$env:DATABASE_URL = ($databaseUrlLine -split "=", 2)[1].Trim().Trim('"')

Push-Location (Join-Path $projectRoot "packages\\db")
try {
  Write-Host "PostgreSQL is running. Starting Drizzle Studio at https://local.drizzle.studio"
  npx drizzle-kit studio --config drizzle.config.ts
} finally {
  Pop-Location
}
