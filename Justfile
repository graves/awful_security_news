# Justfile for Awful Security News
# Uses Nushell as the shell for fnm/Node.js compatibility

set shell := ["nu", "-c"]

# Configuration
PROJECT_DIR := "/home/tg/awful_security_news"
CONDA_PREFIX := env_var_or_default("CONDA_PREFIX", "/home/tg/miniconda3")

# Binaries (host-side)
AWFUL_TEXT_NEWS_BIN := "/home/tg/.cargo/bin/awful_text_news"
AWFUL_NEWS_VIBES_BIN := "/home/tg/.cargo/bin/awful_news_vibes"
MDBOOK_BIN := "/home/tg/.cargo/bin/mdbook"
SITEMAP_BIN := "/home/tg/.cargo/bin/mdbook-sitemap-generator"

# Awful Jade Configs
AWFUL_CLUSTER_CONFIG := "/home/tg/.config/aj/awful_cluster_config.yaml"
AWFUL_VIBES_CONFIG := "/home/tg/.config/aj/awful_vibes_config.yaml"

# Output directories (served by Caddy from home directory)
OUTPUT_DIR := PROJECT_DIR + "/output"
SITE_OUT := OUTPUT_DIR + "/site"
API_OUT := OUTPUT_DIR + "/api"
VIZ_OUT := OUTPUT_DIR + "/viz"

# Source directories
SRC_API_OUT := PROJECT_DIR + "/api_out"
SRC_VIZ_OUT := PROJECT_DIR + "/viz"

# Default recipe
default: run-edition

# ============================================================================
# DOCKER COMMANDS
# ============================================================================

# Start all services (Caddy + Elasticsearch)
up:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Starting Docker services..."
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml up -d
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Services started. Site available at http://localhost"

# Stop all services
down:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Stopping Docker services..."
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml down

# View logs from all services
logs:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml logs -f

# View logs from specific service
logs-service service:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml logs -f {{service}}

# Restart services
restart:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml restart

# Rebuild Docker images
rebuild:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Rebuilding Docker images..."
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml build --no-cache

# ============================================================================
# EDITION BUILD (runs on host, outputs to Docker-mounted dirs)
# ============================================================================

# Run the full edition build pipeline
run-edition: check-binaries ensure-output-dirs generate-content generate-vibes copy-meta-post build-site copy-outputs index-elasticsearch
    @echo $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Done."

# Verify required binaries exist
check-binaries:
    #!/usr/bin/env nu
    let bins = [
        "{{AWFUL_TEXT_NEWS_BIN}}"
        "{{AWFUL_NEWS_VIBES_BIN}}"
    ]
    for bin in $bins {
        if not ($bin | path exists) {
            print $"ERROR: Missing required binary: ($bin)"
            exit 1
        }
    }
    if not ("{{PROJECT_DIR}}" | path exists) {
        print $"ERROR: Project dir not found: {{PROJECT_DIR}}"
        exit 1
    }
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] All required binaries found."

# Ensure output directories exist
ensure-output-dirs:
    #!/usr/bin/env nu
    mkdir "{{SITE_OUT}}"
    mkdir "{{API_OUT}}"
    mkdir "{{VIZ_OUT}}"
    mkdir "{{SRC_API_OUT}}"
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Output directories ready."

# Generate API JSON and Markdown content
generate-content:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Generating API JSON + Markdown with awful_text_news..."
    cd "{{PROJECT_DIR}}"

    # Set up environment for LibTorch
    $env.PATH = $"{{CONDA_PREFIX}}/bin:/usr/bin:/bin:/home/tg/.cargo/bin"
    $env.LD_LIBRARY_PATH = $"{{CONDA_PREFIX}}/lib:{{CONDA_PREFIX}}/lib/python3.11/site-packages/torch/lib"
    $env.TORCH_USE_CUDA = "0"
    $env.TORCH_CUDA_VERSION = "cpu"

    ^"{{AWFUL_TEXT_NEWS_BIN}}" --json-output-dir "{{SRC_API_OUT}}" --markdown-output-dir src

# Generate daily summary and d3 visualizations (morning only)
generate-vibes:
    #!/usr/bin/env nu
    $env.PATH = $"{{CONDA_PREFIX}}/bin:/usr/bin:/bin:/home/tg/.cargo/bin"
    $env.LD_LIBRARY_PATH = $"{{CONDA_PREFIX}}/lib:{{CONDA_PREFIX}}/lib/python3.11/site-packages/torch/lib"
    $env.TORCH_USE_CUDA = "0"
    $env.TORCH_CUDA_VERSION = "cpu"

    let hour = (date now | date to-timezone "America/New_York" | format date "%H" | into int)
    if $hour >= 4 and $hour < 12 {
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Morning edition detected — running awful_news_vibes..."
        ^"{{AWFUL_NEWS_VIBES_BIN}}" --cluster-config "{{AWFUL_CLUSTER_CONFIG}}" --vibe-config "{{AWFUL_VIBES_CONFIG}}" --api-dir "{{SRC_API_OUT}}" -o "{{SRC_VIZ_OUT}}"
    } else {
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Not morning — skipping awful_news_vibes and reusing existing viz output."
    }

# Copy latest meta post to daily summary
copy-meta-post:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"

    # Find all meta_post.md files and get the latest by modification time
    let meta_posts = (glob "{{SRC_VIZ_OUT}}/**/meta_post.md" | each { |f| { path: $f, mtime: (ls -l $f | get 0.modified) } } | sort-by mtime)

    if ($meta_posts | is-empty) {
        print $"ERROR: No meta_post.md found under {{SRC_VIZ_OUT}}"
        exit 1
    }

    let latest = ($meta_posts | last | get path)

    # Backup existing daily_summary.md
    let summary_path = "{{PROJECT_DIR}}/src/daily_summary.md"
    if ($summary_path | path exists) {
        let backup_dir = "{{PROJECT_DIR}}/src/daily_summaries"
        mkdir $backup_dir
        let today = (date now | format date "%Y-%m-%d")
        let backup_file = $"($backup_dir)/($today)_daily_summary.md"
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Backing up existing daily_summary.md to ($backup_file)..."
        cp $summary_path $backup_file
    }

    cp $latest $summary_path
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Copied ($latest) to daily_summary.md"

# Build the mdBook site on host
build-site:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Building mdBook site..."
    cd "{{PROJECT_DIR}}"

    # Build mdbook to output directory
    ^"{{MDBOOK_BIN}}" build -d "{{SITE_OUT}}"

    # Copy static assets
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Copying static assets..."
    cp "{{PROJECT_DIR}}/daily_analysis.html" "{{SITE_OUT}}/"
    mkdir "{{SITE_OUT}}/assets"
    cp "{{PROJECT_DIR}}/awful_news_vibes.js" "{{SITE_OUT}}/assets/"

    # Write robots.txt
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Writing robots.txt..."
    let robots = "User-agent: *\nDisallow:\nDisallow: /assets\nDisallow: /theme\nSitemap: https://news.awfulsec.com/sitemap.xml"
    $robots | save -f $"{{SITE_OUT}}/robots.txt"

    # Generate sitemap
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Generating sitemap..."
    ^"{{SITEMAP_BIN}}" -d "news.awfulsec.com" -o $"{{SITE_OUT}}/sitemap.xml"

    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Build complete."

# Copy API and VIZ outputs to Docker-mounted directories
copy-outputs: update-viz-index
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Copying API and VIZ to output directories..."

    # Sync API output
    rsync -rl --delete "{{SRC_API_OUT}}/" "{{API_OUT}}/"

    # Sync VIZ output
    rsync -rl --delete "{{SRC_VIZ_OUT}}/" "{{VIZ_OUT}}/"

    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Outputs copied."

# Index content into Elasticsearch via Docker
index-elasticsearch:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Indexing content into Elasticsearch..."
    cd "{{PROJECT_DIR}}"

    # Check if Elasticsearch is healthy
    let es_health = (do { docker compose -f docker-compose.prod.yml exec -T elasticsearch curl -sf http://localhost:9200/_cluster/health } | complete)
    if $es_health.exit_code != 0 {
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] WARNING: Elasticsearch is not available"
        print "Skipping search indexing. Run 'just up' to start services."
        exit 0
    }

    let result = (do { docker compose -f docker-compose.prod.yml run --rm indexer } | complete)
    if $result.exit_code == 0 {
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Elasticsearch indexing completed successfully"
    } else {
        print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] WARNING: Elasticsearch indexing failed"
        print $result.stderr
    }

# ============================================================================
# UTILITY COMMANDS
# ============================================================================

# Check Elasticsearch status
es-status:
    #!/usr/bin/env nu
    print "Checking Elasticsearch cluster health..."
    cd "{{PROJECT_DIR}}"
    let health = (docker compose -f docker-compose.prod.yml exec -T elasticsearch curl -s http://localhost:9200/_cluster/health | from json)
    print $health
    print "\nIndex stats:"
    let stats = (docker compose -f docker-compose.prod.yml exec -T elasticsearch curl -s http://localhost:9200/awful_news/_stats | from json)
    if ($stats | get -i _all?.primaries? | is-not-empty) {
        print ($stats | get _all.primaries)
    } else {
        print "Index not found or empty"
    }

# Run only the indexer
index-only:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml run --rm indexer

# Build only (no indexing) - useful for testing
build-only: check-binaries ensure-output-dirs generate-content generate-vibes copy-meta-post build-site copy-outputs
    @echo $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Build complete (no indexing)."

# Clean all output directories
clean:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Cleaning output directories..."
    rm -rf "{{OUTPUT_DIR}}"
    rm -rf "{{PROJECT_DIR}}/_debug"
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Cleaned."

# Show service status
status:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml ps

# Shell into a running container
shell service:
    #!/usr/bin/env nu
    cd "{{PROJECT_DIR}}"
    docker compose -f docker-compose.prod.yml exec {{service}} sh

# Full reset: stop, clean, rebuild, start
reset: down clean rebuild up
    @echo $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Full reset complete."

# Regenerate viz/index.json from existing viz date directories
update-viz-index:
    #!/usr/bin/env nu
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Updating viz index.json..."
    cd "{{PROJECT_DIR}}"

    # Find all date directories in viz/ that have viz.lifecycles.json
    let dates = (glob "{{SRC_VIZ_OUT}}/2025-*/viz.lifecycles.json"
        | each { |f| $f | path dirname | path basename }
        | sort)

    if ($dates | is-empty) {
        print "ERROR: No viz data found in {{SRC_VIZ_OUT}}"
        exit 1
    }

    let latest = ($dates | last)
    let index = { dates: $dates, latest: $latest, version: 1 }

    $index | to json | save -f "{{SRC_VIZ_OUT}}/index.json"
    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Updated index.json with ($dates | length) dates, latest: ($latest)"

# Force regenerate vibes (ignore time restriction)
force-vibes:
    #!/usr/bin/env nu
    $env.PATH = $"{{CONDA_PREFIX}}/bin:/usr/bin:/bin:/home/tg/.cargo/bin"
    $env.LD_LIBRARY_PATH = $"{{CONDA_PREFIX}}/lib:{{CONDA_PREFIX}}/lib/python3.11/site-packages/torch/lib"
    $env.TORCH_USE_CUDA = "0"
    $env.TORCH_CUDA_VERSION = "cpu"

    print $"[(date now | format date '%Y-%m-%dT%H:%M:%S%z')] Force running awful_news_vibes..."
    ^"{{AWFUL_NEWS_VIBES_BIN}}" --cluster-config "{{AWFUL_CLUSTER_CONFIG}}" --vibe-config "{{AWFUL_VIBES_CONFIG}}" --api-dir "{{SRC_API_OUT}}" -o "{{SRC_VIZ_OUT}}"
