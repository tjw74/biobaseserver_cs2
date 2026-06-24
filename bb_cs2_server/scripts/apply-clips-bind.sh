#!/usr/bin/env bash
# Clips on disk: VM /mnt/backups/biobase/clips -> container /data/clips (6TB /srv/backups/biobase/clips on Proxmox).
# ClarionCore checkout (clearmined):
#   cd /home/clearmined/code/prod/biobase/bb_cs2_server && ./scripts/apply-clips-bind.sh
# Use sudo only if you need chown on a root-owned directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ -f "${COMPOSE_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${COMPOSE_DIR}/.env"
  set +a
fi
HOST_DIR="${BB_CLIPS_HOST_DIR:-/mnt/backups/biobase/clips}"
LEGACY_VOLUME="${BB_CLIPS_LEGACY_VOLUME:-bb_cs2_server_bb_cs2_dashboard_clips}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "ClarionCore:"
  echo "  cd /home/clearmined/code/prod/biobase/bb_cs2_server"
  echo "  ./scripts/apply-clips-bind.sh"
  echo "(sources bb_cs2_server/.env for BB_CLIPS_HOST_DIR)"
  echo "Optional: BB_CLIPS_HOST_DIR=/other/path $0"
  echo "Stale SPA: APPLY_CLIPS_NO_CACHE=1 $0"
  exit 0
fi

owner_nobody() {
  local d="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 65534:65534 "$d" && chmod 755 "$d" && return 0
  fi
  if sudo -n chown -R 65534:65534 "$d" 2>/dev/null && sudo -n chmod 755 "$d" 2>/dev/null; then
    return 0
  fi
  if sudo chown -R 65534:65534 "$d" 2>/dev/null && sudo chmod 755 "$d" 2>/dev/null; then
    return 0
  fi
  return 1
}

if ! mkdir -p "$HOST_DIR" 2>/dev/null; then
  echo "ERROR: cannot create or access ${HOST_DIR} — fix permissions on the parent directory." >&2
  exit 1
fi

# Rootless Docker often cannot bind into 0700 parent dirs; world +x on each parent allows traverse (not list).
rootless_traverse() {
  local d="$HOST_DIR"
  while [[ "$d" != "/" && -n "$d" ]]; do
    if [[ -d "$d" ]]; then
      mode=$(stat -c '%a' "$d" 2>/dev/null || true)
      if [[ "$mode" == "700" || "$mode" == "770" ]]; then
        chmod o+x "$d" 2>/dev/null || sudo chmod o+x "$d" 2>/dev/null || true
      fi
    fi
    d="$(dirname "$d")"
  done
}
rootless_traverse

# NFS: /mnt/backups/biobase/clips is often root:root 755 — clients cannot write. Bind-mount the
# writable sibling directory onto the exact path operators expect (see /etc/fstab on ClarionCore).
CLIP_OFFICIAL="/mnt/backups/biobase/clips"
CLIP_STAGING="/mnt/backups/biobase_clips_upload"
ensure_writable_clips_path() {
  mkdir -p "$CLIP_STAGING" 2>/dev/null || true
  chmod 777 "$CLIP_STAGING" 2>/dev/null || sudo chmod 777 "$CLIP_STAGING" 2>/dev/null || true
  if [[ "$HOST_DIR" != "$CLIP_OFFICIAL" ]]; then
    return 0
  fi
  local t="${HOST_DIR}/.bb_prebind_$$"
  if (umask 022 && : >"$t" && rm -f "$t") 2>/dev/null; then
    return 0
  fi
  echo "NOTICE: ${HOST_DIR} is not client-writable (NFS). Binding ${CLIP_STAGING} -> ${HOST_DIR} ..."
  if mountpoint -q "$HOST_DIR" 2>/dev/null; then
    src=$(findmnt -n -o SOURCE "$HOST_DIR" 2>/dev/null || true)
    if [[ "$src" == *bind* ]] || [[ "$src" == *biobase_clips_upload* ]]; then
      return 0
    fi
  fi
  sudo mount --bind "$CLIP_STAGING" "$HOST_DIR" || {
    echo "ERROR: sudo mount --bind ${CLIP_STAGING} ${HOST_DIR} failed. Add to /etc/fstab:" >&2
    echo "  ${CLIP_STAGING} ${HOST_DIR} none bind,nofail 0 0" >&2
    exit 1
  }
}
ensure_writable_clips_path

# Persist bind across reboots (requires /mnt/backups mounted first so staging exists).
persist_clips_bind_fstab() {
  [[ "$HOST_DIR" == "$CLIP_OFFICIAL" ]] || return 0
  local line='/mnt/backups/biobase_clips_upload /mnt/backups/biobase/clips none bind,nofail 0 0'
  if [[ -r /etc/fstab ]] && ! grep -qF '/mnt/backups/biobase_clips_upload /mnt/backups/biobase/clips' /etc/fstab; then
    echo "$line" | sudo tee -a /etc/fstab >/dev/null
  fi
  sudo mount -a 2>/dev/null || true
}
persist_clips_bind_fstab

if ! owner_nobody "$HOST_DIR"; then
  echo "WARN: could not chown ${HOST_DIR} to 65534:nobody — uploads fail until:" >&2
  echo "  sudo chown -R 65534:65534 ${HOST_DIR} && sudo chmod 755 ${HOST_DIR}" >&2
fi

writetest="${HOST_DIR}/.bb_clips_writetest_$$"
if ! (umask 022 && : >"$writetest" && rm -f "$writetest") 2>/dev/null; then
  echo "ERROR: cannot create files in ${HOST_DIR} (tried as $(whoami))." >&2
  echo "If this path is NFS (e.g. Proxmox /srv/backups), fix the export: rw + permissions for the" >&2
  echo "squashed client user (often chmod 775 or chown to nfsnobody/anonuid on the server, or adjust /etc/exports)." >&2
  exit 1
fi

if docker volume inspect "$LEGACY_VOLUME" &>/dev/null; then
  echo "Migrating clips from Docker volume ${LEGACY_VOLUME} -> ${HOST_DIR} ..."
  # Pipe avoids binding HOST_DIR into a helper container (rootless Docker often cannot bind /mnt/...).
  if docker run --rm -v "${LEGACY_VOLUME}:/from:ro" alpine:3.20 tar -C /from -cf - . \
    | tar -C "$HOST_DIR" -xf -; then
    :
  else
    echo "WARN: migration copy failed (partial content may remain in ${HOST_DIR})" >&2
  fi
  owner_nobody "$HOST_DIR" || true
  echo "Optional: docker volume rm ${LEGACY_VOLUME}"
fi

cd "$COMPOSE_DIR"
export BB_CLIPS_HOST_DIR="$HOST_DIR"
if ! docker compose config --services &>/dev/null; then
  echo "docker compose failed in ${COMPOSE_DIR}" >&2
  exit 1
fi

echo "Recreating bb_cs2_dashboard (bind ${HOST_DIR} -> /data/clips) ..."
if [[ "${APPLY_CLIPS_NO_CACHE:-0}" == "1" ]]; then
  docker compose build --no-cache bb_cs2_dashboard
else
  docker compose build bb_cs2_dashboard
fi
docker compose up -d --force-recreate --no-deps bb_cs2_dashboard

echo "--- Mount (expect Source=${HOST_DIR} -> /data/clips) ---"
docker inspect bb_cs2_dashboard --format '{{range .Mounts}}{{println .Source " -> " .Destination}}{{end}}' | grep /data/clips || {
  echo "WARNING: no /data/clips mount — check docker inspect bb_cs2_dashboard" >&2
}

echo "Done. Clips on this host: ${HOST_DIR}"
