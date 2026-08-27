#!/bin/sh
set -eu

backup_path="/var/backups/hifly/hifly-systemd-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"

docker compose -p hifly-pilot -f /opt/hifly-pilot/docker-compose.production.yml exec -T app sh -ceu '
  umask 077
  exec npm run db:backup -- --output "$1"
' backup "$backup_path"

docker compose -p hifly-pilot -f /opt/hifly-pilot/docker-compose.production.yml exec -T app pg_restore --list "$backup_path"
