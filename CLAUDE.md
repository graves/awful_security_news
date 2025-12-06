# CLAUDE.md - Awful Security News Repository Guide

## Project Overview

**Awful Security News** is an automated daily news aggregation and narrative analysis platform. It fetches security/technology news from multiple sources, summarizes articles using an LLM (Qwen 3 4B), generates D3.js visualizations analyzing media narratives, and publishes everything through an mdBook-based static site with Elasticsearch search.

- **Website:** https://news.awfulsec.com
- **Repository:** github.com/graves/awful_security_news
- **Author:** Thomas Graves

## Quick Reference Commands

```bash
# Build and deploy
just run-edition          # Full build pipeline (default)
just build-only           # Build without Elasticsearch indexing
just force-vibes          # Generate viz data (ignores morning-only restriction)
just update-viz-index     # Regenerate viz/index.json from existing data

# Docker services
just up                   # Start Elasticsearch
just down                 # Stop services
just restart              # Restart services
just status               # Show container status
just logs                 # View all logs
just es-status            # Check Elasticsearch health

# Utilities
just clean                # Delete all output directories
just reset                # Full reset (down, clean, rebuild, up)
just index-only           # Run Elasticsearch indexer separately
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEMD TIMER (3x daily)                          │
│                        6am, 12pm, 6pm Eastern Time                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          just run-edition                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. awful_text_news     → api_out/*.json + src/*.md                         │
│  2. awful_news_vibes    → viz/*.json (morning only)                         │
│  3. copy meta_post.md   → src/daily_summary.md                              │
│  4. mdbook build        → output/site/                                      │
│  5. rsync outputs       → output/api/, output/viz/                          │
│  6. index_elasticsearch → Elasticsearch index                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CADDY (Host)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  /           → output/site/        (static HTML)                            │
│  /api/*      → output/api/         (JSON data)                              │
│  /viz/*      → output/viz/         (visualization JSON)                     │
│  /search/*   → localhost:9200      (Elasticsearch proxy)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
awful_security_news/
├── src/                          # mdBook source (Markdown content)
│   ├── SUMMARY.md               # Table of contents
│   ├── home.md                  # Homepage
│   ├── daily_summary.md         # Latest analysis (auto-updated)
│   ├── daily_analysis.html      # Interactive dashboard reference
│   ├── 2025-*.md                # Daily news editions
│   ├── daily_summaries/         # Backup archive
│   └── theme/                   # Custom mdBook theme
│       ├── elasticsearch-search.js
│       ├── elasticsearch-search.css
│       └── index.hbs
│
├── assets/                      # Static assets and scripts
│   ├── daily_analysis.html      # Dashboard template (copied to site)
│   ├── awful_news_vibes.js      # D3 visualization renderer
│   ├── index_elasticsearch.js   # Search indexer script
│   └── screenshot-of-website.png
│
├── docker/                      # Docker configuration
│   ├── Dockerfile               # Node.js indexer container
│   ├── docker-compose.yml       # Development config
│   └── docker-compose.prod.yml  # Production config
│
├── systemd/                     # Systemd service files
│   ├── awful-news.service       # Docker stack management
│   ├── awful-news-edition.service  # Build runner
│   ├── awful-news-edition.timer    # 3x daily scheduler
│   └── elasticsearch.service    # Reference service file
│
├── scripts/                     # Shell scripts (legacy/utilities)
│   ├── run_edition.sh           # Legacy bash build script
│   ├── process-files.sh         # File processing utilities
│   └── setup-search.sh          # Search setup script
│
├── api_out/                     # Generated API JSON (source)
│   └── 2025-MM-DD/
│       ├── morning.json
│       ├── afternoon.json
│       └── evening.json
│
├── viz/                         # Generated visualization data (source)
│   ├── index.json               # Date index for frontend
│   └── 2025-MM-DD/
│       ├── meta_post.md         # Daily narrative summary
│       ├── viz.lifecycles.json  # Story tracking
│       ├── viz.momentum.json    # Coverage velocity
│       ├── viz.divergence.json  # Outlet framing
│       ├── viz.emotion.json     # Emotional tone
│       ├── viz.compass.json     # Sentiment compass
│       ├── viz.silences.json    # Absent narratives
│       ├── viz.clouds.json      # Word clouds
│       └── viz.fingerprints.json
│
├── output/                      # Docker-mounted serving directory (generated)
│   ├── site/                    # Built HTML (served at /)
│   ├── api/                     # Synced from api_out/
│   └── viz/                     # Synced from viz/
│
├── Justfile                     # Build orchestration (Nushell)
├── book.toml                    # mdBook configuration
├── package.json                 # Node.js dependencies
├── CLAUDE.md                    # This documentation file
├── README.md                    # Project overview
└── LICENSE                      # MIT license
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Build System | Justfile + Nushell | Task orchestration |
| Content Gen | `awful_text_news` (Rust) | News fetching & LLM summarization |
| Visualization | `awful_news_vibes` (Rust) | Narrative analysis & viz data |
| Site Builder | mdBook (Rust) | Static HTML generation |
| Search | Elasticsearch 8.11.0 | Full-text search backend |
| Indexer | Node.js + JSDOM | HTML parsing & indexing |
| Frontend Viz | D3.js v7 | Client-side visualizations |
| Web Server | Caddy (host) | Reverse proxy & file serving |
| Containers | Docker Compose | Elasticsearch isolation |
| Scheduling | systemd timers | 3x daily builds |

## External Binaries (Not in Repo)

These Rust binaries must be installed separately at `/home/tg/.cargo/bin/`:

- **awful_text_news** - Fetches news, runs LLM summarization, outputs JSON + Markdown
- **awful_news_vibes** - Generates narrative analysis and D3 visualization data
- **mdbook** - Builds static HTML site from Markdown
- **mdbook-sitemap-generator** - Generates sitemap.xml for SEO

## Configuration Files

### Justfile Variables
```just
PROJECT_DIR := "/home/tg/awful_security_news"
OUTPUT_DIR := PROJECT_DIR + "/output"
SITE_OUT := OUTPUT_DIR + "/site"
API_OUT := OUTPUT_DIR + "/api"
VIZ_OUT := OUTPUT_DIR + "/viz"
SRC_API_OUT := PROJECT_DIR + "/api_out"
SRC_VIZ_OUT := PROJECT_DIR + "/viz"
```

### External Config (not in repo)
- `/home/tg/.config/aj/awful_cluster_config.yaml` - Story clustering settings
- `/home/tg/.config/aj/awful_vibes_config.yaml` - Visualization settings

### book.toml
- Theme: Ayu dark
- Custom search: Elasticsearch (replaces default)
- Output: `output/site/`

## Key Workflows

### Full Edition Build (`just run-edition`)
1. **check-binaries** - Verify all required binaries exist
2. **ensure-output-dirs** - Create output directories
3. **generate-content** - Run `awful_text_news` → JSON + Markdown
4. **generate-vibes** - Run `awful_news_vibes` (4am-12pm only) → viz data
5. **copy-meta-post** - Copy latest meta_post.md → daily_summary.md
6. **build-site** - Run mdbook, copy assets, generate robots.txt + sitemap
7. **update-viz-index** - Regenerate viz/index.json from directories
8. **copy-outputs** - rsync api_out/ and viz/ to output/
9. **index-elasticsearch** - Index HTML content for search

### Visualization Generation
- Only runs during morning edition (4am-12pm Eastern)
- Other editions reuse existing viz data
- Use `just force-vibes` to regenerate manually

### Search Indexing
- Parses all HTML in output/site/
- Extracts: title, breadcrumbs, body text
- Creates `awful_news` index in Elasticsearch
- Query weights: title^3, breadcrumbs^2, body

## Daily Analysis Dashboard

The `daily_analysis.html` page provides interactive D3 visualizations:

1. **Story Momentum** - Coverage velocity over editions
2. **Narrative Divergence** - How outlets frame stories differently
3. **Emotional Temperature** - Tone analysis (anger, fear, hope, etc.)
4. **Story Compass** - Sentiment/complexity positioning
5. **Silence Tracker** - Notably absent narratives
6. **Story Fingerprints** - Story uniqueness metrics
7. **Word Clouds** - Term frequency by outlet and cluster
8. **Story Lifecycles** - Coverage patterns over time

Data loaded from `/viz/index.json` → `/viz/2025-MM-DD/viz.*.json`

## Docker Services

### Elasticsearch
- Image: `docker.elastic.co/elasticsearch/elasticsearch:8.11.0`
- Port: 127.0.0.1:9200 (localhost only)
- Security: Disabled (internal use only)
- Volume: `elasticsearch_data` (persistent)

### Indexer
- Runs on-demand via `docker compose run`
- Mounts: output/site/, assets/index_elasticsearch.js, package.json
- Requires: Elasticsearch healthy

## Caddy Configuration (Host)

```caddy
news.awfulsec.com {
    root * /home/tg/awful_security_news/output/site
    file_server

    handle /search/* {
        uri strip_prefix /search
        reverse_proxy localhost:9200
    }

    handle /api/* {
        root * /home/tg/awful_security_news/output
        file_server
    }

    handle /viz/* {
        root * /home/tg/awful_security_news/output
        file_server
    }
}
```

## Systemd Services

### awful-news-edition.timer
Runs at 6am, 12pm, 6pm Eastern Time (America/New_York)

### awful-news-edition.service
Executes: `/home/tg/.cargo/bin/just run-edition`

### awful-news.service
Manages Docker stack (start/stop)

## Common Issues & Solutions

### Viz dropdown not showing new dates
The `viz/index.json` needs to be regenerated:
```bash
just update-viz-index
just copy-outputs
```

### Elasticsearch 403/connection errors
Check if services are running:
```bash
just status
just es-status
```

### Morning-only visualization
`generate-vibes` only runs 4am-12pm Eastern. Force it:
```bash
just force-vibes
```

### Caddy can't access home directory
Ensure `ProtectHome=false` in Caddy's systemd override:
```bash
sudo systemctl edit caddy
# Add: [Service]
#      ProtectHome=false
sudo systemctl daemon-reload && sudo systemctl restart caddy
```

### Missing daily_analysis.html content
The HTML file must be copied AFTER mdbook build:
```bash
cp assets/daily_analysis.html output/site/
```
This is handled automatically by `build-site` recipe.

## Data Flow Summary

```
News Sources → awful_text_news → api_out/*.json + src/*.md
                                        │
api_out/*.json → awful_news_vibes → viz/*.json
                                        │
src/*.md + viz/meta_post.md → mdbook → output/site/*.html
                                        │
output/site/*.html → index_elasticsearch.js → Elasticsearch
                                        │
Browser → Caddy → output/site/ + output/api/ + output/viz/ + Elasticsearch
```

## Environment Requirements

- Nushell (for Justfile execution)
- Docker & Docker Compose
- Rust toolchain (for external binaries)
- Node.js 18+ (for indexer)
- Caddy web server (host-level)

## File Naming Conventions

### Daily News Markdown
- `2025-MM-DD.md` - Daily summary
- `2025-MM-DD_morning.md` - Morning edition
- `2025-MM-DD_afternoon.md` - Afternoon edition
- `2025-MM-DD_evening.md` - Evening edition

### Visualization JSON
- `viz.lifecycles.json` - Story tracking
- `viz.momentum.json` - Coverage velocity
- `viz.divergence.json` - Framing differences
- `viz.emotion.json` - Emotional analysis
- `viz.compass.json` - Sentiment positioning
- `viz.silences.json` - Absent narratives
- `viz.clouds.json` - Word frequencies
- `viz.fingerprints.json` - Story uniqueness

## Security Notes

- Elasticsearch security disabled (internal only, behind Caddy)
- All content served as static files
- GPG signatures available for verification (.asc files)
- No user authentication required (public read-only)
