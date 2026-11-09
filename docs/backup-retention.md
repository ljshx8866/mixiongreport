# Production backup retention and cleanup

The production backup directory is `/opt/restaurant-report/backups`. Keep only
the directly stored compressed full MySQL backups (`*.sql.gz`) under the policy
below; the cleanup tool never recurses into subdirectories and never removes
source snapshots, release packages, application configuration, or key files.

## Retention policy

- Keep only the newest complete, gzip-verified full backup for each of the last
  3 Shanghai calendar days (today and the previous 2 days). This removes
  same-day duplicates as well as backups older than 3 days.
- Before choosing the daily copy, verify the compressed stream and CRC and
  confirm it contains a MySQL/MariaDB dump header and at least 5 `CREATE TABLE`
  definitions. This rejects tiny table-only exports. If the newest file is
  incomplete or is not a full dump, try the next newest file for that day.
- If there is no valid backup in the last 3 days, stop without deleting files.
- Run cleanup only after backup creation has finished. Gzip and SQL-marker
  checks do not prove that MySQL can restore the dump.

## Run

Preview the exact files and bytes eligible for removal (default):

```bash
python3 /opt/restaurant-report/scripts/cleanup-backups.py
```

Apply the same deterministic policy after reviewing the preview:

```bash
python3 /opt/restaurant-report/scripts/cleanup-backups.py --apply
```

The command reports each checked, kept, and deleted file and the reclaimed
bytes. It does not recurse or delete Docker volumes, images, or files outside
the top-level `*.sql.gz` backup set. Review the dry run before applying it.
