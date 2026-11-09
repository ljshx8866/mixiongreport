#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR=/opt/restaurant-report
BACKUP_DIR="$APP_DIR/backups"
cd "$APP_DIR"

TODAY="$(TZ=Asia/Shanghai date +%Y%m%d)"
BACKUP_RESULT="$(systemctl show --property=Result --value restaurant-report-backup.service)"
if [[ "$BACKUP_RESULT" != "success" ]]; then
  echo "Skipping sync-log compaction: today's backup service result is '$BACKUP_RESULT'."
  exit 1
fi

BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "restaurant-report-db-${TODAY}-*.sql.gz" -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Skipping sync-log compaction: no completed database backup from today."
  exit 1
fi
gzip -t -- "$BACKUP_FILE"

AVAILABLE_KIB="$(df -Pk / | awk 'NR == 2 { print $4 }')"
MINIMUM_KIB=8388608 # 8 GiB, including room for an InnoDB table rebuild.
if (( AVAILABLE_KIB < MINIMUM_KIB )); then
  echo "Skipping sync-log compaction: only ${AVAILABLE_KIB} KiB is free; at least ${MINIMUM_KIB} KiB is required."
  exit 1
fi

curl -fsS --max-time 5 http://127.0.0.1:3000/health >/dev/null

docker compose exec -T db sh -s <<'CONTAINER_SCRIPT'
set -eu
umask 077
client_file="$(mktemp)"
trap 'rm -f -- "$client_file"' EXIT
printf '[client]\nuser=root\npassword=%s\n' "$MYSQL_ROOT_PASSWORD" > "$client_file"

replica_count="$(mysql --defaults-extra-file="$client_file" --batch --skip-column-names -e 'SHOW REPLICA STATUS' | wc -l)"
if [ "$replica_count" -gt 0 ]; then
  echo "Skipping payload cleanup: a MySQL replica is configured."
  exit 1
fi

total=0
while :; do
  changed="$(mysql --defaults-extra-file="$client_file" --batch --skip-column-names "$MYSQL_DATABASE" -e "SET SESSION sql_log_bin=0; UPDATE api_sync_logs SET response_payload=NULL WHERE started_at < UTC_TIMESTAMP() - INTERVAL 3 DAY AND response_payload IS NOT NULL AND OCTET_LENGTH(response_payload)>65536 ORDER BY id LIMIT 50; SELECT ROW_COUNT();" | tail -n1)"
  changed="${changed:-0}"
  case "$changed" in
    ''|*[!0-9]*) echo "Unexpected affected-row count: $changed" >&2; exit 1 ;;
  esac
  total=$((total + changed))
  echo "Cleared $changed expired payload row(s); total $total."
  [ "$changed" -gt 0 ] || break
done

if [ "$total" -gt 0 ]; then
  mysql --defaults-extra-file="$client_file" --batch "$MYSQL_DATABASE" -e 'OPTIMIZE TABLE api_sync_logs'
fi

mysql --defaults-extra-file="$client_file" --batch --skip-column-names -e "SELECT CONCAT('api_sync_logs size MiB: ', ROUND((DATA_LENGTH+INDEX_LENGTH)/1024/1024,1)) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$MYSQL_DATABASE' AND TABLE_NAME='api_sync_logs';"
CONTAINER_SCRIPT

echo "Sync-log payload maintenance completed using verified backup: $(basename "$BACKUP_FILE")"
