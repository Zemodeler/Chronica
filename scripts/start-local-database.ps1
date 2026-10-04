$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".cache\postgres-runtime"
$control = Join-Path $runtimeRoot "pgsql\bin\pg_ctl.exe"
$data = Join-Path $runtimeRoot "data"
if (-not (Test-Path -LiteralPath $control) -or -not (Test-Path -LiteralPath (Join-Path $data "PG_VERSION"))) { exit 0 }
& $control -D $data status | Out-Null
if ($LASTEXITCODE -eq 0) { exit 0 }
$log = Join-Path $runtimeRoot "postgres.log"
& $control -D $data -l $log -w start
exit $LASTEXITCODE
