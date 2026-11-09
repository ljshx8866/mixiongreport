# Database and log retention policy

## Active policy

- POS synchronization records remain available for audit and report timing. The raw POS response is not needed by the report or sync-log UI; new successful syncs store only a small count summary.
- A daily API job clears at most 50 `response_payload` values larger than 64 KiB from sync records older than three days. It preserves the sync row, store/date, status, timestamps, and error text; the batch cap keeps catch-up work bounded.
- Full logical MySQL backups run daily at 02:30 China time. The backup is streamed through gzip, integrity-tested, and only then published; the existing retention script keeps one complete backup per Shanghai calendar day for the latest three days.
- MySQL binary logs are retained for seven days. This provides a recovery window beyond the three-day full-backup window; it must be changed if replication or a longer point-in-time recovery requirement is introduced.
- Do not run `OPTIMIZE TABLE` as a daily task. InnoDB reuses freed pages after payload cleanup; physical compaction is a separate maintenance operation, after backup verification and disk-space checks.
- A one-time low-traffic compaction is scheduled for 2026-10-24 03:45 China time. It runs only after that day's backup succeeds, verifies the gzip dump, confirms at least 8 GiB free, confirms the API is healthy, and confirms there is no MySQL replica. It clears expired oversized response payloads in 50-row batches and rebuilds only `api_sync_logs`.

## Routine checks

- Daily: backup service success, latest backup age, root filesystem free space, and binlog size. The API clears no more than 50 expired payload rows per day at 03:15 China time.
- Weekly: compare `api_sync_logs` and database volume growth against the expected workload.
- Monthly or before migration: inspect image tags and remove only unreferenced old images after retaining the current image and a tested rollback image.
- Keep Docker stdout logs bounded when each service is next recreated; current container logs are small, so do not restart the full stack just to rotate them.

## Safety rules

- Never remove sync metadata rows as part of payload cleanup; older business reports use those rows to show sync status and time.
- Never purge binary logs before verifying a recent full backup and checking that no replica or external point-in-time recovery consumer depends on them.
- Run table compaction only after a successful backup and with sufficient free disk for a temporary table rebuild. Confirm application health immediately afterward.
