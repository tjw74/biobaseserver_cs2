#!/usr/bin/env bash
# Run once on the Proxmox host as root so ClarionCore can write NFS-mounted clips.
# Default export path for the 6TB backup tree: /srv/backups/biobase/clips
set -euo pipefail
DIR="${1:-/srv/backups/biobase/clips}"
mkdir -p "$DIR"
# Container bb_cs2_dashboard runs as nobody (65534) unless overridden.
chown -R 65534:65534 "$DIR"
chmod 775 "$DIR"
echo "OK: $DIR is writable by NFS clients mapped to uid 65534 (verify /etc/exports rw)."
