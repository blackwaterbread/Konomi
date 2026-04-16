#!/bin/sh
set -e

PUID=${PUID:-911}
PGID=${PGID:-911}
KONOMI_DB_DATA="/config/mysql"
SOCKET="/run/mysqld/mysqld.sock"

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

  # On first run, create konomi user with TCP access
  if [ "$FIRST_RUN" = "true" ]; then
    echo "Creating database user..."
    mariadb --socket="$SOCKET" <<'EOSQL'
CREATE DATABASE IF NOT EXISTS `konomi` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'konomi'@'127.0.0.1' IDENTIFIED BY 'konomi';
GRANT ALL PRIVILEGES ON `konomi`.* TO 'konomi'@'127.0.0.1';
FLUSH PRIVILEGES;
EOSQL
  fi

  # Run schema init SQL (idempotent)
  mariadb --socket="$SOCKET" < /app/docker/init.sql
  echo "MariaDB ready."
}

# ── Main ──────────────────────────────────────────────────────
if [ "$(id -u)" = "0" ]; then
  if ! getent group konomi > /dev/null 2>&1; then
    addgroup -g "$PGID" konomi
  fi
  if ! getent passwd konomi > /dev/null 2>&1; then
    adduser -u "$PUID" -G konomi -D -H konomi
  fi

  mkdir -p /config "$KONOMI_DB_DATA"
  chown -R mysql:mysql "$KONOMI_DB_DATA"
  chown konomi:konomi /images /config 2>/dev/null || true

  init_mariadb

  echo "Starting Konomi as uid=$PUID gid=$PGID"
  exec gosu konomi:konomi "$@"
else
  mkdir -p "$KONOMI_DB_DATA"
  init_mariadb
  exec "$@"
fi
