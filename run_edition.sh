#!/usr/bin/env bash
set -euo pipefail
umask 0002

# ---------- Config (edit these if your paths differ) ----------
# Conda env providing PyTorch/LibTorch (base in your case)
CONDA_PREFIX="${CONDA_PREFIX:-/home/tg/miniconda3}"

# Binaries
AWFUL_BIN="/home/tg/.cargo/bin/awful_text_news"
MDBOOK_BIN="/home/tg/.cargo/bin/mdbook"                        # adjust if installed elsewhere
SITEMAP_BIN="/home/tg/.cargo/bin/mdbook-sitemap-generator"    # adjust if installed elsewhere

# Project & deploy paths
PROJECT_DIR="/home/tg/awful_security_news"
SITE_HOSTNAME="news.awfulsec.com"
DEPLOY_ROOT="/var/www/html/${SITE_HOSTNAME}"
API_DEST="${DEPLOY_ROOT}/api"
SITE_DEST="${DEPLOY_ROOT}"

# ---------- Minimal PATH and loader just for *this* process ----------
export PATH="${CONDA_PREFIX}/bin:/usr/bin:/bin:/home/tg/.cargo/bin"
# Add only the lib dirs your binary needs (LibTorch + MKL)
export LD_LIBRARY_PATH="${CONDA_PREFIX}/lib:${CONDA_PREFIX}/lib/python3.11/site-packages/torch/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# If your build accidentally tries CUDA, keep it on CPU:
export TORCH_USE_CUDA=0
export TORCH_CUDA_VERSION=cpu

# ---------- Helpers ----------
log() { printf '[%(%Y-%m-%dT%H:%M:%S%z)T] %s\n' -1 "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_bin() { command -v "$1" >/dev/null 2>&1 || die "Missing required binary: $1"; }

write_robots() {
  local directory="$1"
  mkdir -p "$directory"
  cat > "${directory}/robots.txt" <<'ROBOTS'
User-agent: *
Disallow:
Disallow: /assets
Disallow: /theme
Sitemap: https://news.awfulsec.com/sitemap.xml
ROBOTS
}

# ---------- Preconditions ----------
require_bin "$AWFUL_BIN"
require_bin "$MDBOOK_BIN"
require_bin "$SITEMAP_BIN"
[[ -d "$PROJECT_DIR" ]] || die "Project dir not found: $PROJECT_DIR"

# Ensure deploy roots exist (must be writable by user or its group)
mkdir -p "$API_DEST" "$SITE_DEST"

# ---------- Staging ----------
STAGE="$(mktemp -d --tmpdir "${SITE_HOSTNAME}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
log "Using staging dir: $STAGE"

# These are relative to project (mdbook expects md sources in ./src)
API_OUT="${PROJECT_DIR}/api_out"         # kept for compatibility with project layout
SITE_BUILD="${STAGE}/daily_news"         # final mdBook output

# ---------- Generate API JSON + Markdown sources ----------
log "Generating API JSON + Markdown with awful_text_news..."
cd "$PROJECT_DIR"
mkdir -p "$API_OUT"
"$AWFUL_BIN" --json-output-dir "$API_OUT" --markdown-output-dir "src"

# ---------- Build site ----------
log "Building mdBook..."
# -d to put the build output into staging
"$MDBOOK_BIN" build -d "$SITE_BUILD"

# robots.txt + sitemap
log "Writing robots.txt..."
write_robots "$SITE_BUILD"
log "Generating sitemap..."
"$SITEMAP_BIN" -d "$SITE_HOSTNAME" -o "${SITE_BUILD}/sitemap.xml"

# ---------- Deploy atomically ----------
log "Deploying API to ${API_DEST}..."
# -rl : recurse, preserve symlinks; no -t (times)
# --omit-dir-times: don't try to set directory mtimes (avoids EPERM)
# --no-perms/owner/group: don't try to chown/chgrp/chmod
# --delete: sync deletions safely
rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  "${API_OUT}/" "${API_DEST}/"

log "Deploying site to ${SITE_DEST}..."
rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude '/api/' \
  "${SITE_BUILD}/" "${SITE_DEST}/"

# ---------- Cleanup ----------
#log "Cleaning project API_OUT..."
#rm -rf "$API_OUT"

log "Done."
