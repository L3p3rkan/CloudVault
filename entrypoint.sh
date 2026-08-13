#!/bin/sh
set -e

# Docker named volumes are created owned by root. The vault user (UID 1001)
# cannot create subdirectories in /data/uploads unless we fix ownership first.
# This runs as root (PID 1), fixes the directory, then hands off to vault.
#
# On Unraid with a bind-mounted Share, the host directory may also be owned by
# root or another UID — this corrects that on every container start.
mkdir -p /data/uploads
chown -R vault:vault /data/uploads

# Drop privileges and exec the app (replaces this shell — PID 1 stays clean)
exec su-exec vault node --enable-source-maps ./dist/index.mjs
