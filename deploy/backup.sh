#!/bin/sh
# PhysioCare backups: database (pg_dump, compressed) and uploaded files (tar.gz).
#   sh backup.sh now             one backup now
#   sh backup.sh loop            every night at BACKUP_HOUR (used by the backup container)
#   sh backup.sh restore <file>  restore a database dump (asks to type RESTORE)
set -eu
DIR=/backups
KEEP=${BACKUP_KEEP_DAYS:-30}
HOST=${PGHOST:-postgres}
DB=${PGDATABASE:-physiocare}
USER=${PGUSER:-physio}

backup() {
  ts=$(date +%Y-%m-%d_%H%M)
  mkdir -p "$DIR"
  pg_dump -h "$HOST" -U "$USER" -d "$DB" -Fc -Z 6 -f "$DIR/db_$ts.dump.part" && mv "$DIR/db_$ts.dump.part" "$DIR/db_$ts.dump"
  if [ -d /data/storage ]; then tar -czf "$DIR/files_$ts.tar.gz.part" -C /data storage && mv "$DIR/files_$ts.tar.gz.part" "$DIR/files_$ts.tar.gz"; fi
  # Check the dump can be read back (catches broken or empty backups).
  pg_restore --list "$DIR/db_$ts.dump" > /dev/null
  find "$DIR" -name 'db_*.dump' -mtime +"$KEEP" -delete
  find "$DIR" -name 'files_*.tar.gz' -mtime +"$KEEP" -delete
  echo "[backup] $(date -Iseconds) ok: db_$ts.dump ($(du -h "$DIR/db_$ts.dump" | cut -f1))"
}

case "${1:-now}" in
  now) backup ;;
  loop)
    echo "[backup] nightly at ${BACKUP_HOUR:-2}:00, keeping $KEEP days"
    while true; do
      if [ "$(date +%H)" = "$(printf '%02d' "${BACKUP_HOUR:-2}")" ] && [ ! -f "/tmp/done_$(date +%F)" ]; then
        backup || echo "[backup] $(date -Iseconds) FAILED"
        touch "/tmp/done_$(date +%F)"
      fi
      sleep 300
    done ;;
  restore)
    f=${2:?Usage: backup.sh restore /backups/db_YYYY-MM-DD_HHMM.dump}
    printf 'This replaces the live database with %s. Type RESTORE to continue: ' "$f"; read -r ok
    [ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
    pg_restore -h "$HOST" -U "$USER" -d "$DB" --clean --if-exists --no-owner "$f"
    echo "[backup] restored $f" ;;
  *) echo "Usage: backup.sh now | loop | restore <file>"; exit 1 ;;
esac
