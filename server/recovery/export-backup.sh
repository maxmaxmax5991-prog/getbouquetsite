#!/bin/sh
# Export an already completed native PocketBase backup to encrypted restic storage.
# No service restart, live SQLite copy, retention pruning or repository init.
set -eu
umask 077
: "${RESTIC_REPOSITORY:?Set a repository outside the primary provider}"
: "${RESTIC_PASSWORD_FILE:?Set the path to the restic password file}"
ROOT=${VENIKOFF_ROOT:-/opt/venikoff}
BACKUPS=${PB_BACKUPS_DIR:-$ROOT/pb/pb_data/backups}
MAX_AGE=${MAX_BACKUP_AGE_SECONDS:-93600}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for tool in restic python3 flock; do command -v "$tool" >/dev/null; done
[ -f "$RESTIC_PASSWORD_FILE" ]
[ -f "$ROOT/pb/pocketbase" ]
[ -d "$ROOT/pb/pb_hooks" ]
[ -d "$ROOT/pb/pb_migrations" ]
[ -d "$ROOT/site" ]
exec 9>"${BACKUP_LOCK_FILE:-/run/lock/venikoff-export.lock}"
flock -n 9 || { echo 'Another export is running' >&2; exit 1; }
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
# Copy to a private staging area; fail if the source changes while being read.
python3 - "$BACKUPS" "$STAGE/pocketbase.zip" "$MAX_AGE" <<'PY'
import pathlib, shutil, sys, time
folder, destination, max_age = sys.argv[1:]
archives = [p for p in pathlib.Path(folder).glob('*.zip') if p.is_file() and not p.is_symlink()]
if not archives:
    raise SystemExit('No native PocketBase ZIP backups found; confirm the actual backup location')
latest = max(archives, key=lambda p: p.stat().st_mtime)
before = latest.stat()
age = time.time() - before.st_mtime
if age < 60 or age > int(max_age):
    raise SystemExit('Latest backup is still settling or too old')
shutil.copyfile(latest, destination)
after = latest.stat()
if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
    raise SystemExit('Backup changed during copy')
print('Native backup age (seconds):', int(age))
PY
python3 "$SCRIPT_DIR/pb_backup.py" "$STAGE/pocketbase.zip"
# Keep a stable archive path inside each snapshot despite random staging paths.
cd "$STAGE"
"$ROOT/pb/pocketbase" --version > pocketbase-version.txt
restic backup --host venikoff-primary --tag venikoff-recovery \
  pocketbase.zip pocketbase-version.txt "$ROOT/pb/pocketbase" \
  "$ROOT/pb/pb_hooks" "$ROOT/pb/pb_migrations" "$ROOT/site" "$ROOT/bin" \
  /etc/caddy/Caddyfile /etc/systemd/system/venikoff-pb.service
