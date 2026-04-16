#!/bin/sh
set -e

# ── PUID / PGID handling ───────────────────────────────────
# Creates a non-root user "konomi" with the specified UID/GID
# so that files written inside the container match host ownership.

PUID=${PUID:-1000}
PGID=${PGID:-1000}

if [ "$(id -u)" = "0" ]; then
  # Create group if it doesn't exist
  if ! getent group konomi > /dev/null 2>&1; then
    addgroup --gid "$PGID" konomi
  fi

  # Create user if it doesn't exist
  if ! getent passwd konomi > /dev/null 2>&1; then
    adduser --uid "$PUID" --ingroup konomi --disabled-password --gecos "" --no-create-home konomi
  fi

  # Ensure data directories are accessible
  chown konomi:konomi /images /config 2>/dev/null || true

  echo "Starting Konomi as uid=$PUID gid=$PGID"
  exec su-exec konomi:konomi "$@"
else
  # Already non-root (e.g. rootless Docker)
  exec "$@"
fi
