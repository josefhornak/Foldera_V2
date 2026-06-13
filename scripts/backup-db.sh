#!/usr/bin/env bash
#
# Daily PostgreSQL backup for Foldera V2.
# Dumps the foldera_v2 database from the running postgres container, gzips it to
# a timestamped file, prunes dumps older than RETENTION_DAYS, and logs a line.
#
# Restore:  gunzip -c <file>.sql.gz | docker exec -i foldera-v2-postgres psql -U foldera -d foldera_v2
#
set -euo pipefail

BACKUP_DIR="${FOLDERA_BACKUP_DIR:-/home/deploy/backups}"
RETENTION_DAYS="${FOLDERA_BACKUP_RETENTION_DAYS:-14}"
CONTAINER="foldera-v2-postgres"
DB="foldera_v2"
DB_USER="foldera"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/foldera-v2-$TS.sql.gz"

# --clean --if-exists so the dump can be restored over an existing database.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB" --clean --if-exists | gzip > "$OUT"

# Fail loudly if the dump came out suspiciously small (gzip header alone ~20B).
SIZE="$(stat -c%s "$OUT")"
if [ "$SIZE" -lt 1000 ]; then
  echo "$(date -Iseconds) ERROR backup too small (${SIZE}B): $OUT" >&2
  exit 1
fi

# Prune old dumps.
find "$BACKUP_DIR" -name 'foldera-v2-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "$(date -Iseconds) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
