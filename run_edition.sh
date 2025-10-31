#!/usr/bin/env bash
set -euo pipefail
umask 0002

# ---------- Config ----------------------
# Conda env providing PyTorch/LibTorch
CONDA_PREFIX="${CONDA_PREFIX:-/home/tg/miniconda3}"

# Binaries
AWFUL_TEXT_NEWS_BIN="/home/tg/.cargo/bin/awful_text_news"
AWFUL_NEWS_VIBES_BIN="/home/tg/.cargo/bin/awful_news_vibes"
MDBOOK_BIN="/home/tg/.cargo/bin/mdbook"
SITEMAP_BIN="/home/tg/.cargo/bin/mdbook-sitemap-generator"

# Awful Jade Configs
AWFUL_CLUSTER_CONFIG="/home/tg/.config/aj/awful_cluster_config.yaml"
AWFUL_VIBES_CONFIG="/home/tg/.config/aj/awful_vibes_config.yaml"

# Project & deploy paths
PROJECT_DIR="/home/tg/awful_security_news"
SITE_HOSTNAME="news.awfulsec.com"
DEPLOY_ROOT="/var/www/html/${SITE_HOSTNAME}"
SITE_DEST="${DEPLOY_ROOT}"
API_DEST="${DEPLOY_ROOT}/api"
VIZ_DEST="${DEPLOY_ROOT}/viz"

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

TZ="America/New_York"
export TZ

is_morning() {
  # 0-padded hour in local TZ
  local hour
  hour=$(date +%H)
  # morning: 05:00–11:59
  if (( 10#$hour >= 5 && 10#$hour < 12 )); then
    return 0
  else
    return 1
  fi
}

# ----

# ---------- Preconditions ----------
require_bin "$AWFUL_TEXT_NEWS_BIN"
require_bin "$AWFUL_NEWS_VIBES_BIN"
require_bin "$MDBOOK_BIN"
require_bin "$SITEMAP_BIN"
[[ -d "$PROJECT_DIR" ]] || die "Project dir not found: $PROJECT_DIR"

# Ensure deploy roots exist (must be writable by user or its group)
mkdir -p "$API_DEST" "$VIZ_DEST" "$SITE_DEST"

# ---------- Staging ----------
STAGE="$(mktemp -d --tmpdir "${SITE_HOSTNAME}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
log "Using staging dir: $STAGE"

# These are relative to project (mdbook expects md sources in ./src)
API_OUT="${PROJECT_DIR}/api_out"         # json api output
VIZ_OUT="${PROJECT_DIR}/viz"             # d3 visualization data
SITE_BUILD="${STAGE}/daily_news"         # final mdBook output

# ---------- Generate API JSON + Markdown sources ----------
log "Generating API JSON + Markdown with awful_text_news..."
cd "$PROJECT_DIR"
mkdir -p "$API_OUT"
"$AWFUL_TEXT_NEWS_BIN" --json-output-dir "$API_OUT" --markdown-output-dir "src"

# ---------- Generate Daily Summary and d3 visualizations ----------
log "Generating Daily Summary and d3 visualizations with awful_news_vibes..."
if is_morning; then
  log "Morning edition detected — running awful_news_vibes..."
  "$AWFUL_NEWS_VIBES_BIN" \
    --cluster-config "$AWFUL_CLUSTER_CONFIG" \
    --vibe-config "$AWFUL_VIBES_CONFIG" \
    --api-dir "$API_OUT" \
    -o "$VIZ_OUT"
else
  log "Not morning — skipping awful_news_vibes and reusing existing viz output."
fi

shopt -s nullglob
mapfile -t META_POSTS < <(find "$VIZ_OUT" -mindepth 2 -maxdepth 2 -type f -name 'meta_post.md' -printf '%T@ %p\n' | sort -n | awk '{ $1=""; sub(/^ /,""); print }')
[[ ${#META_POSTS[@]} -eq 0 ]] && die "No meta_post.md found under $VIZ_OUT"
LATEST_META="${META_POSTS[-1]}"

# Backup existing daily_summary.md before overwriting
if [[ -f "${PROJECT_DIR}/src/daily_summary.md" ]]; then
  BACKUP_DIR="${PROJECT_DIR}/src/daily_summaries"
  mkdir -p "$BACKUP_DIR"
  TODAY_DATE=$(date +%Y-%m-%d)
  BACKUP_FILE="${BACKUP_DIR}/${TODAY_DATE}_daily_summary.md"
  log "Backing up existing daily_summary.md to ${BACKUP_FILE}..."
  cp "${PROJECT_DIR}/src/daily_summary.md" "$BACKUP_FILE"
fi

cp "$LATEST_META" "${PROJECT_DIR}/src/daily_summary.md"

# ---------- Build site ----------
log "Building mdBook..."
# -d to put the build output into staging
"$MDBOOK_BIN" build -d "$SITE_BUILD"

# ---------- Copy static viz pages ----
log "Copying viz html and js files..."
cp "${PROJECT_DIR}/daily_analysis.html" "${SITE_BUILD}"
cp "${PROJECT_DIR}/awful_news_vibes.js" "${SITE_BUILD}/assets"

# robots.txt + sitemap
log "Writing robots.txt..."
write_robots "$SITE_BUILD"
log "Generating sitemap..."
"$SITEMAP_BIN" -d "$SITE_HOSTNAME" -o "${SITE_BUILD}/sitemap.xml"

# ---------- Deploy atomically ----------
log "Deploying API to ${API_DEST}..."
# First, ensure we can delete files by fixing permissions
if [[ -d "${API_DEST}" ]]; then
  find "${API_DEST}" -type d -exec chmod u+rwx {} + 2>/dev/null || true
  find "${API_DEST}" -type f -exec chmod u+rw {} + 2>/dev/null || true
fi

# -rl : recurse, preserve symlinks
# --omit-dir-times: don't try to set directory mtimes (avoids EPERM)
# --no-perms/owner/group: don't try to chown/chgrp/chmod (avoids EPERM)
# --delete: sync deletions safely
rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  "${API_OUT}/" "${API_DEST}/"

# Set proper permissions after sync
find "${API_DEST}" -type d -exec chmod 775 {} + 2>/dev/null || true
find "${API_DEST}" -type f -exec chmod 664 {} + 2>/dev/null || true

log "Deploying VIZ to ${VIZ_DEST}..."
# First, ensure we can delete files by fixing permissions
if [[ -d "${VIZ_DEST}" ]]; then
  find "${VIZ_DEST}" -type d -exec chmod u+rwx {} + 2>/dev/null || true
  find "${VIZ_DEST}" -type f -exec chmod u+rw {} + 2>/dev/null || true
fi

rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  "${VIZ_OUT}/" "${VIZ_DEST}/"

# Set proper permissions after sync
find "${VIZ_DEST}" -type d -exec chmod 775 {} + 2>/dev/null || true
find "${VIZ_DEST}" -type f -exec chmod 664 {} + 2>/dev/null || true

log "Deploying site to ${SITE_DEST}..."
# First, ensure we can delete files by fixing permissions
if [[ -d "${SITE_DEST}" ]]; then
  find "${SITE_DEST}" -type d ! -path "*/api/*" ! -path "*/api" -exec chmod u+rwx {} + 2>/dev/null || true
  find "${SITE_DEST}" -type f ! -path "*/api/*" -exec chmod u+rw {} + 2>/dev/null || true
fi

rsync -rl --delete --omit-dir-times --no-perms --no-owner --no-group \
  --exclude '/api/' \
  --exclude '/viz/' \
  "${SITE_BUILD}/" "${SITE_DEST}/"

# Set proper permissions after sync
find "${SITE_DEST}" -type d ! -path "*/api/*" ! -path "*/api" -exec chmod 775 {} + 2>/dev/null || true
find "${SITE_DEST}" -type f ! -path "*/api/*" -exec chmod 664 {} + 2>/dev/null || true
find "${SITE_DEST}" -type d ! -path "*/viz/*" ! -path "*/viz" -exec chmod 775 {} + 2>/dev/null || true
find "${SITE_DEST}" -type f ! -path "*/viz/*" -exec chmod 664 {} + 2>/dev/null || true

# ---------- Cleanup ----------
log "Cleaning project API_OUT..."
#rm -rf "$API_OUT"
log "Cleaning project VIZ_OUT..."
#rm -rf "$VIZ_OUT"
log "Cleaning project _debug..."
rm -rf "${PROJECT_DIR}/_debug"

log "Done."
