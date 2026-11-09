#!/usr/bin/env python3
"""Prune redundant top-level compressed MySQL backups using a disk-aware retention policy."""

from __future__ import annotations

import argparse
import gzip
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
MIN_TABLE_DDL_COUNT = 5


def is_complete_gzip(path: Path) -> bool:
    """Verify gzip CRC/trailer and reject tiny table-only SQL exports."""
    try:
        with gzip.open(path, "rb") as stream:
            prefix = stream.read(1024 * 1024).lower()
            has_dump_header = b"mysql dump" in prefix or b"mariadb dump" in prefix
            marker = b"create table"
            table_ddl_count = prefix.count(marker)
            tail = prefix[-(len(marker) - 1):]
            while block := stream.read(1024 * 1024):
                scan = tail + block.lower()
                table_ddl_count += scan.count(marker)
                tail = scan[-(len(marker) - 1):]
    except (OSError, EOFError):
        return False
    return has_dump_header and table_ddl_count >= MIN_TABLE_DDL_COUNT


def main() -> int:
    default_dir = Path(__file__).resolve().parent.parent / "backups"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=default_dir,
                        help="backup directory (only direct *.sql.gz files are considered)")
    parser.add_argument("--apply", action="store_true", help="delete the listed eligible files")
    args = parser.parse_args()

    if args.dir.is_symlink():
        parser.error("backup directory must be a real directory, not a symlink")
    backup_dir = args.dir.resolve(strict=True)
    if not backup_dir.is_dir():
        parser.error("backup path must be a directory")

    now = datetime.now(TZ)
    today = now.date()
    files: list[tuple[Path, datetime]] = []
    for path in backup_dir.glob("*.sql.gz"):
        if path.is_symlink() or not path.is_file():
            continue
        mtime = datetime.fromtimestamp(path.stat().st_mtime, TZ)
        files.append((path, mtime))

    if not files:
        print(f"No top-level *.sql.gz backups found in {backup_dir}")
        return 0

    # Keep one fully readable compressed dump per Shanghai calendar day,
    # including today and the previous two days. This also consolidates
    # duplicate backups created on the same day.
    keep: dict[Path, list[str]] = defaultdict(list)
    recent_days = sorted({modified.date() for _, modified in files
                          if 0 <= (today - modified.date()).days < 3}, reverse=True)
    for day in recent_days:
        daily_candidates = sorted(
            ((path, modified) for path, modified in files if modified.date() == day),
            key=lambda item: item[1],
            reverse=True,
        )
        for path, modified in daily_candidates:
            print(f"CHECK  {modified:%Y-%m-%d %H:%M}  {path.name} (verify full database dump)")
            if is_complete_gzip(path):
                keep[path].append("newest valid backup for day within 3 days")
                break

    if not keep:
        print("No complete *.sql.gz backup found in the last 3 Shanghai calendar days; refusing to delete anything.")
        return 2

    total_delete = 0
    eligible: list[tuple[Path, int, datetime]] = []
    for path, modified in sorted(files, key=lambda item: item[1], reverse=True):
        size = path.stat().st_size
        if path in keep:
            print(f"KEEP   {size:>12}  {modified:%Y-%m-%d %H:%M}  {path.name} ({'; '.join(keep[path])})")
        elif modified.date() > today:
            print(f"KEEP   {size:>12}  {modified:%Y-%m-%d %H:%M}  {path.name} (future timestamp; review clock)")
        else:
            eligible.append((path, size, modified))
            total_delete += size
            print(f"DELETE {size:>12}  {modified:%Y-%m-%d %H:%M}  {path.name}")

    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}; candidates: {len(eligible)}; reclaimable: {total_delete} bytes")
    if args.apply:
        for path, _, _ in eligible:
            if path.parent != backup_dir or path.is_symlink() or path.suffix != ".gz" or not path.name.endswith(".sql.gz"):
                raise RuntimeError(f"Refusing to delete unexpected path: {path}")
            path.unlink()
            print(f"DELETED {path.name}")
        print(f"Cleanup complete; removed {len(eligible)} backup file(s).")
    else:
        print("No files deleted. Rerun with --apply to enforce this list.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
