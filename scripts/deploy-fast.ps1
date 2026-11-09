[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('admin', 'api')]
  [string]$Target,
  [string]$Server = 'mixiong-new',
  [string]$RemoteUser = 'ubuntu',
  [string]$SshKey,
  [switch]$ApiCodeOnly,
  [switch]$ApiWithPrismaClient,
  [string]$RequiredMigration
)

$ErrorActionPreference = 'Stop'

if ($Target -eq 'api' -and ($ApiCodeOnly -eq $ApiWithPrismaClient)) {
  throw 'For API deployment, choose exactly one of -ApiCodeOnly or -ApiWithPrismaClient.'
}
if ($Target -ne 'api' -and ($ApiCodeOnly -or $ApiWithPrismaClient -or $RequiredMigration)) {
  throw 'API deployment options can only be used with -Target api.'
}
if ($ApiWithPrismaClient -and $RequiredMigration -notmatch '^\d{14}_[a-z0-9_]+$') {
  throw 'Prisma client deployment requires -RequiredMigration with a valid migration name that has already been applied to production.'
}
if (-not $ApiWithPrismaClient -and $RequiredMigration) {
  throw '-RequiredMigration can only be used with -ApiWithPrismaClient.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$scpExe = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
$tarCommand = Get-Command tar.exe -ErrorAction SilentlyContinue
$tarExe = if ($tarCommand) { $tarCommand.Source } else { $null }
if (-not $tarExe) {
  $gitTar = Join-Path $env:ProgramFiles 'Git\usr\bin\tar.exe'
  if (Test-Path -LiteralPath $gitTar) { $tarExe = $gitTar }
}
if (-not $tarExe) { throw 'tar.exe was not found in PATH or the standard Git for Windows installation.' }
if (-not (Test-Path -LiteralPath $sshExe) -or -not (Test-Path -LiteralPath $scpExe)) {
  throw 'Windows OpenSSH client (ssh.exe/scp.exe) was not found.'
}

if ($Target -eq 'admin') {
  & npm run build -w admin
} else {
  if ($ApiWithPrismaClient) {
    $schemaEngine = Join-Path $repoRoot 'node_modules\@prisma\engines\schema-engine-windows.exe'
    $queryEngine = Join-Path $repoRoot 'node_modules\@prisma\engines\query_engine-windows.dll.node'
    if ((Test-Path -LiteralPath $schemaEngine) -and (Test-Path -LiteralPath $queryEngine)) {
      $env:PRISMA_SCHEMA_ENGINE_BINARY = $schemaEngine
      $env:PRISMA_QUERY_ENGINE_LIBRARY = $queryEngine
    }
    & npm run prisma:generate
    Remove-Item Env:\PRISMA_SCHEMA_ENGINE_BINARY -ErrorAction SilentlyContinue
    Remove-Item Env:\PRISMA_QUERY_ENGINE_LIBRARY -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
  }
  & npm run build
}
if ($LASTEXITCODE -ne 0) { throw "Build failed for target '$Target'." }

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$tempRoot = Join-Path $env:TEMP "mixiong-fast-$Target-$stamp"
$packageRoot = Join-Path $tempRoot 'package'
$archive = Join-Path $tempRoot "fast-$Target-$stamp.tar"
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

try {
  if ($Target -eq 'admin') {
    $adminDist = Join-Path $repoRoot 'apps\admin\dist'
    if (-not (Test-Path -LiteralPath (Join-Path $adminDist 'index.html'))) {
      throw "Admin build output is missing: $adminDist"
    }
    New-Item -ItemType Directory -Path (Join-Path $packageRoot 'apps\admin') -Force | Out-Null
    Copy-Item -LiteralPath $adminDist -Destination (Join-Path $packageRoot 'apps\admin\dist') -Recurse -Force
  } else {
    foreach ($relative in @('apps\api\dist', 'packages\report-engine\dist', 'packages\hr-engine\dist')) {
      if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative))) {
        throw "API build output is missing: $relative"
      }
    }
    New-Item -ItemType Directory -Path (Join-Path $packageRoot 'apps\api') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $packageRoot 'packages\report-engine') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $packageRoot 'packages\hr-engine') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'apps\api\dist') -Destination (Join-Path $packageRoot 'apps\api\dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'packages\report-engine\dist') -Destination (Join-Path $packageRoot 'packages\report-engine\dist') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'packages\hr-engine\dist') -Destination (Join-Path $packageRoot 'packages\hr-engine\dist') -Recurse -Force
    if ($ApiWithPrismaClient) {
      $prismaSource = Join-Path $repoRoot 'database\prisma'
      if (-not (Test-Path -LiteralPath (Join-Path $prismaSource 'schema.prisma'))) {
        throw 'Prisma schema source is missing.'
      }
      New-Item -ItemType Directory -Path (Join-Path $packageRoot 'database') -Force | Out-Null
      Copy-Item -LiteralPath $prismaSource -Destination (Join-Path $packageRoot 'database\prisma') -Recurse -Force
    }
  }

  $entries = if ($Target -eq 'admin') { @('apps/admin/dist') } else { @('apps/api/dist', 'packages/report-engine/dist', 'packages/hr-engine/dist') }
  if ($Target -eq 'api' -and $ApiWithPrismaClient) { $entries += @('database/prisma') }
  $tarArguments = @('--force-local', '-cf', $archive, '-C', $packageRoot) + @($entries)
  & $tarExe @tarArguments
  if ($LASTEXITCODE -ne 0) { throw 'Could not package the built artifacts.' }

  $remote = "$RemoteUser@$Server"
  $remoteArchive = "/tmp/fast-$Target-$stamp.tar"
  $sshOptions = @('-o', 'ServerAliveInterval=20')
  if ($SshKey) {
    $sshOptions += @('-i', $SshKey)
  }

  & $scpExe @sshOptions -- $archive "${remote}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Artifact transfer failed; production was not changed.' }

  $remoteScript = @'
set -euo pipefail
ROOT=/opt/restaurant-report
TARGET=__TARGET__
STAMP=__STAMP__
ARCHIVE=__REMOTE_ARCHIVE__
PRISMA_CLIENT=__PRISMA_CLIENT__
REQUIRED_MIGRATION=__REQUIRED_MIGRATION__
RELEASE="$ROOT/release-staging/fast-$TARGET-$STAMP"
IMAGE="restaurant-report-$TARGET"
cd "$ROOT"
CONTAINER="$(docker compose ps -q "$TARGET")"
test -n "$CONTAINER"
if [ "$TARGET" = api ] && [ "$PRISMA_CLIENT" = true ]; then
  DB_CONTAINER="$(docker compose ps -q db)"
  test -n "$DB_CONTAINER"
  APPLIED="$(docker exec "$DB_CONTAINER" sh -lc "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot \"\$MYSQL_DATABASE\" -Nse \"SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name='$REQUIRED_MIGRATION' AND finished_at IS NOT NULL\"")"
  if [ "$APPLIED" != 1 ]; then echo "Required migration is not applied: $REQUIRED_MIGRATION" >&2; exit 1; fi
fi
BEFORE_IMAGE="$(docker inspect -f '{{.Image}}' "$CONTAINER")"
docker image tag "$BEFORE_IMAGE" "$IMAGE:rollback-latest"
mkdir -p "$RELEASE"
tar -xf "$ARCHIVE" -C "$RELEASE"

rollback() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs --tail 120 "$CONTAINER" >&2 || true
    docker image tag "$IMAGE:rollback-latest" "$IMAGE:latest" || true
    docker compose up -d --no-deps --no-build --force-recreate "$TARGET" || true
  fi
  exit "$status"
}
trap rollback EXIT

if [ "$TARGET" = admin ]; then
  docker exec "$CONTAINER" sh -c 'rm -rf /app/dist.next /app/dist.rollback && mkdir -p /app/dist.next'
  docker cp "$RELEASE/apps/admin/dist/." "$CONTAINER:/app/dist.next/"
  docker exec "$CONTAINER" sh -c 'chmod -R a+rX /app/dist.next && mv /app/dist /app/dist.rollback && mv /app/dist.next /app/dist && rm -rf /app/dist.rollback'
else
  docker exec "$CONTAINER" sh -c 'rm -rf /app/apps/api/dist.next /app/packages/report-engine/dist.next /app/packages/hr-engine/dist.next && mkdir -p /app/apps/api/dist.next /app/packages/report-engine/dist.next /app/packages/hr-engine/dist.next'
  docker cp "$RELEASE/apps/api/dist/." "$CONTAINER:/app/apps/api/dist.next/"
  docker cp "$RELEASE/packages/report-engine/dist/." "$CONTAINER:/app/packages/report-engine/dist.next/"
  docker cp "$RELEASE/packages/hr-engine/dist/." "$CONTAINER:/app/packages/hr-engine/dist.next/"
  docker exec "$CONTAINER" sh -c 'chmod -R a+rX /app/apps/api/dist.next /app/packages/report-engine/dist.next /app/packages/hr-engine/dist.next && mv /app/apps/api/dist /app/apps/api/dist.rollback && mv /app/apps/api/dist.next /app/apps/api/dist && mv /app/packages/report-engine/dist /app/packages/report-engine/dist.rollback && mv /app/packages/report-engine/dist.next /app/packages/report-engine/dist && mv /app/packages/hr-engine/dist /app/packages/hr-engine/dist.rollback && mv /app/packages/hr-engine/dist.next /app/packages/hr-engine/dist && rm -rf /app/apps/api/dist.rollback /app/packages/report-engine/dist.rollback /app/packages/hr-engine/dist.rollback'
  if [ "$PRISMA_CLIENT" = true ]; then
    docker exec "$CONTAINER" sh -c 'rm -rf /app/database/prisma.next /app/database/prisma.rollback && mkdir -p /app/database/prisma.next'
    docker cp "$RELEASE/database/prisma/." "$CONTAINER:/app/database/prisma.next/"
    docker exec "$CONTAINER" sh -c 'chmod -R a+rX /app/database/prisma.next && mv /app/database/prisma /app/database/prisma.rollback && mv /app/database/prisma.next /app/database/prisma && rm -rf /app/database/prisma.rollback'
    docker exec "$CONTAINER" /app/node_modules/.bin/prisma generate --schema /app/database/prisma/schema.prisma
    docker exec "$CONTAINER" chmod -R a+rX /app/node_modules/.prisma/client
  fi
fi

docker commit "$CONTAINER" "$IMAGE:latest" >/dev/null
docker compose up -d --no-deps --no-build --force-recreate "$TARGET"
if [ "$TARGET" = api ]; then
  ready=0
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/health | grep -q '"status":"ok"'; then ready=1; break; fi
    sleep 2
  done
  test "$ready" -eq 1
else
  ready=0
  for attempt in $(seq 1 30); do
    if curl -fsS https://mixiong6.com/ -o /dev/null 2>/dev/null; then ready=1; break; fi
    sleep 2
  done
  if [ "$ready" -ne 1 ]; then curl -fsS https://mixiong6.com/ -o /dev/null; fi
  test "$ready" -eq 1
fi

if [ "$TARGET" = api ] && [ "$PRISMA_CLIENT" = true ]; then
  mkdir -p "$ROOT/database/prisma.next"
  cp -a "$RELEASE/database/prisma/." "$ROOT/database/prisma.next/"
  rm -rf "$ROOT/database/prisma.previous"
  mv "$ROOT/database/prisma" "$ROOT/database/prisma.previous"
  mv "$ROOT/database/prisma.next" "$ROOT/database/prisma"
  rm -rf "$ROOT/database/prisma.previous"
fi

trap - EXIT
case "$RELEASE" in "$ROOT"/release-staging/fast-"$TARGET"-*) rm -rf -- "$RELEASE" ;; *) exit 90 ;; esac
rm -f -- "$ARCHIVE"
echo "Incremental $TARGET deployment $STAMP succeeded; previous image is $IMAGE:rollback-latest."
'@
  $prismaClientValue = if ($ApiWithPrismaClient) { 'true' } else { 'false' }
  $migrationValue = if ($RequiredMigration) { $RequiredMigration } else { 'none' }
  $remoteScript = $remoteScript.Replace('__TARGET__', $Target).Replace('__STAMP__', $stamp).Replace('__REMOTE_ARCHIVE__', $remoteArchive).Replace('__PRISMA_CLIENT__', $prismaClientValue).Replace('__REQUIRED_MIGRATION__', $migrationValue)
  $encodedScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  $remoteCommand = "printf '%s' '$encodedScript' | base64 -d | sudo -n bash"
  & $sshExe @sshOptions $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'Incremental deployment failed. The remote script attempts to restore the previous image if its smoke check fails.' }
} finally {
  $tempPath = [IO.Path]::GetFullPath($tempRoot)
  $tempBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  if ($tempPath.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $tempPath)) {
    Remove-Item -LiteralPath $tempPath -Recurse -Force
  }
}


