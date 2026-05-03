#!/bin/sh
set -e

KONOMI_DB_DATA="/config/mysql"
SOCKET="/run/mysqld/mysqld.sock"

# ── Require explicit PUID/PGID ───────────────────────────────
# A wrong default silently produces empty scans (EACCES on bind-mounted
# volumes), which is harder to debug than a startup failure. Force the
# operator to state the host UID/GID that owns the mounted images.
if [ "$(id -u)" = "0" ]; then
  missing=""
  [ -z "$PUID" ] && missing="$missing PUID"
  [ -z "$PGID" ] && missing="$missing PGID"
  if [ -n "$missing" ]; then
    echo "ERROR: required environment variable(s) not set:$missing" >&2
    echo "       Set PUID and PGID to the host user/group that owns the mounted /images volume." >&2
    echo "       Example (Synology with shared 'users' group): -e PUID=1026 -e PGID=100" >&2
    exit 1
  fi
  case "$PUID" in *[!0-9]*) echo "ERROR: PUID must be numeric, got: $PUID" >&2; exit 1 ;; esac
  case "$PGID" in *[!0-9]*) echo "ERROR: PGID must be numeric, got: $PGID" >&2; exit 1 ;; esac
fi

# ── MariaDB bootstrap ────────────────────────────────────────
init_mariadb() {
  mkdir -p /run/mysqld
  chown mysql:mysql /run/mysqld

  FIRST_RUN=false
  if [ ! -d "$KONOMI_DB_DATA/mysql" ]; then
    FIRST_RUN=true
    echo "Initializing MariaDB data directory..."
    mysql_install_db --user=mysql --datadir="$KONOMI_DB_DATA" --skip-test-db > /dev/null 2>&1
  fi

  echo "Starting MariaDB..."
  mariadbd --user=mysql --datadir="$KONOMI_DB_DATA" \
    --skip-networking=0 --bind-address=127.0.0.1 --port=3306 \
    --socket="$SOCKET" &

  # Wait for MariaDB to be ready
  for i in $(seq 1 30); do
    if mariadb-admin ping --socket="$SOCKET" --silent 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if ! mariadb-admin ping --socket="$SOCKET" --silent 2>/dev/null; then
    echo "ERROR: MariaDB failed to start within 30 seconds"
    exit 1
  fi

  # On first run, create konomi user with TCP access. The database itself
  # and all schema migrations are applied by the Node process at startup
  # (see src/core/lib/db.ts:runMigrations + src/server/db.ts:ensureDatabase).
  if [ "$FIRST_RUN" = "true" ]; then
    echo "Creating database user..."
    mariadb --socket="$SOCKET" <<'EOSQL'
CREATE USER IF NOT EXISTS 'konomi'@'127.0.0.1' IDENTIFIED BY 'konomi';
GRANT ALL PRIVILEGES ON `konomi`.* TO 'konomi'@'127.0.0.1';
FLUSH PRIVILEGES;
EOSQL
  fi

  echo "MariaDB ready."
}

# ── Main ──────────────────────────────────────────────────────
if [ "$(id -u)" = "0" ]; then
  # Reuse a pre-existing group at PGID (e.g. Alpine's built-in `users` group
  # at gid 100 — common Synology mapping) instead of trying to create a
  # second group at the same gid, which addgroup rejects with "gid in use".
  EXISTING_GROUP="$(getent group "$PGID" | cut -d: -f1)"
  if [ -n "$EXISTING_GROUP" ]; then
    GROUP_NAME="$EXISTING_GROUP"
  else
    GROUP_NAME="konomi"
    addgroup -g "$PGID" konomi
  fi

  EXISTING_USER="$(getent passwd "$PUID" | cut -d: -f1)"
  if [ -n "$EXISTING_USER" ]; then
    USER_NAME="$EXISTING_USER"
  else
    USER_NAME="konomi"
    adduser -u "$PUID" -G "$GROUP_NAME" -D -H konomi
  fi

  mkdir -p /config "$KONOMI_DB_DATA"
  chown -R mysql:mysql "$KONOMI_DB_DATA"
  chown "$USER_NAME:$GROUP_NAME" /images /config 2>/dev/null || true

  init_mariadb

  echo "Starting Konomi as uid=$PUID gid=$PGID"
  exec gosu "$USER_NAME:$GROUP_NAME" "$@"
else
  mkdir -p "$KONOMI_DB_DATA"
  init_mariadb
  exec "$@"
fi
