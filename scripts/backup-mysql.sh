#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR=/opt/restaurant-report
BACKUP_DIR="$APP_DIR/backups"
STAMP="$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/restaurant-report-db-$STAMP.sql.gz"
TEMP_FILE="$TARGET.tmp"

cd "$APP_DIR"
trap 'rm -f -- "$TEMP_FILE"' EXIT

# Stream a consistent logical backup directly to gzip. The DB password is
# read inside the database container and written only to a mode-0600 temp file.
docker compose exec -T -i db sh -s <<'CONTAINER_SCRIPT' | gzip -1 > "$TEMP_FILE"
  set -eu
  umask 077
  client_file="$(mktemp)"
  trap 'rm -f -- "$client_file"' EXIT
  printf "[client]\nuser=root\npassword=%s\n" "$MYSQL_ROOT_PASSWORD" > "$client_file"
  mysqldump --defaults-extra-file="$client_file" --single-transaction --quick \
    --routines --events --triggers --hex-blob --set-gtid-purged=OFF "$MYSQL_DATABASE"
CONTAINER_SCRIPT

# Publish only a complete gzip stream. Retention runs only after this succeeds.
gzip -t "$TEMP_FILE"
mv -- "$TEMP_FILE" "$TARGET"
trap - EXIT
python3 scripts/cleanup-backups.py --dir "$BACKUP_DIR" --apply
