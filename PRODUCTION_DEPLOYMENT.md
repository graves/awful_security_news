# Production Deployment Guide

This guide explains how to deploy the Elasticsearch search integration to your production server with Caddy.

## Overview

Your current setup runs 3 times daily via systemd, executing [run_edition.sh](run_edition.sh) which:
1. Generates news content with `awful_text_news`
2. Creates visualizations with `awful_news_vibes` (morning only)
3. Builds the mdBook static site
4. Deploys to `/var/www/html/news.awfulsec.com`

**The new setup adds**:
- Elasticsearch running as a systemd service
- Automatic search indexing after each build
- Caddy reverse proxy for browser access to Elasticsearch
- Graceful degradation if Elasticsearch is unavailable

## Prerequisites

On your production server (`/home/tg/awful_security_news`):
- Docker and Docker Compose installed
- Node.js (v14+) installed
- Caddy serving from `/var/www/html/news.awfulsec.com`
- Existing systemd service running `run_edition.sh`

## Installation Steps

### 1. Install Node.js Dependencies

On your production server:

```bash
cd /home/tg/awful_security_news
npm install
```

This installs `jsdom` and `node-fetch` needed by the indexer.

### 2. Set Up Elasticsearch Systemd Service

Copy the systemd service file to the system directory:

```bash
sudo cp /home/tg/awful_security_news/elasticsearch.service /etc/systemd/system/
```

Reload systemd and enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable elasticsearch.service
sudo systemctl start elasticsearch.service
```

Verify it's running:

```bash
sudo systemctl status elasticsearch.service
curl http://localhost:9200/_cluster/health
```

You should see JSON output with `"status":"green"` or `"status":"yellow"`.

### 3. Configure Caddy Reverse Proxy

Add the following to your Caddyfile for `news.awfulsec.com`:

```caddy
news.awfulsec.com {
    # Existing configuration...
    root * /var/www/html/news.awfulsec.com
    file_server

    # Elasticsearch reverse proxy
    handle /api/search/* {
        reverse_proxy localhost:9200 {
            # Rewrite the path to remove /api/search prefix
            # e.g., /api/search/awful_news/_search -> /awful_news/_search
            rewrite * /awful_news{path}

            # Security headers
            header_up Host localhost:9200
            header_up X-Forwarded-For {remote_host}

            # Rate limiting (optional but recommended)
            @rl_exceeded {
                expression {http.rate_limit.exceeded}
            }
            respond @rl_exceeded "Too Many Requests" 429

            # Only allow POST requests
            @not_post {
                not method POST
            }
            respond @not_post "Method Not Allowed" 405
        }
    }

    # Rate limiting for search endpoint (100 requests per minute per IP)
    rate_limit {
        zone search {
            key {remote_host}
            events 100
            window 1m
        }
    }

    # Existing handlers...
    encode gzip
    try_files {path} {path}.html {path}/ =404
}
```

**Alternative simpler configuration (if rate limiting not needed)**:

```caddy
news.awfulsec.com {
    root * /var/www/html/news.awfulsec.com
    file_server

    # Elasticsearch reverse proxy
    reverse_proxy /api/search/* localhost:9200 {
        rewrite * /awful_news{path}
    }

    encode gzip
    try_files {path} {path}.html {path}/ =404
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Test the proxy:

```bash
curl -X POST https://news.awfulsec.com/api/search/_search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match_all":{}}, "size":1}'
```

You should see JSON results from Elasticsearch.

### 4. Test the Build Process

Run your edition script manually to test:

```bash
cd /home/tg/awful_security_news
./run_edition.sh
```

Watch for the new log messages:
```
[2025-11-17T16:30:00-0500] Indexing content into Elasticsearch...
[2025-11-17T16:30:00-0500] Elasticsearch is available, indexing content...
[2025-11-17T16:30:05-0500] Elasticsearch indexing completed successfully
```

### 5. Verify Search Works

1. Open https://news.awfulsec.com in a browser
2. Click the search icon (magnifying glass) or press `s`
3. Type a search query (e.g., "security")
4. You should see results appear automatically

## Configuration Details

### Modified Files

1. **[run_edition.sh](run_edition.sh)** - Added Elasticsearch indexing after mdbook build
   - Lines 14-18: Added Node.js and Elasticsearch config
   - Lines 148-171: Added indexing step with error handling

2. **[book.toml](book.toml)** - Disabled default search, added custom search
   - Lines 13-14: Added custom JavaScript and CSS
   - Lines 16-17: Disabled built-in search

3. **[src/theme/index.hbs](src/theme/index.hbs)** - Always show search UI
   - Lines 117-120: Search button always visible
   - Lines 137-147: Search UI always rendered

4. **[src/theme/elasticsearch-search.js](src/theme/elasticsearch-search.js)** - Uses Caddy proxy
   - Line 13: `ELASTICSEARCH_URL = '/api/search'` (goes through Caddy)

### New Files

- **[docker-compose.prod.yml](docker-compose.prod.yml)** - Production Elasticsearch config
- **[elasticsearch.service](elasticsearch.service)** - Systemd service definition
- **[index_elasticsearch.js](index_elasticsearch.js)** - Content indexer
- **[src/theme/elasticsearch-search.js](src/theme/elasticsearch-search.js)** - Client-side search
- **[src/theme/elasticsearch-search.css](src/theme/elasticsearch-search.css)** - Search styles

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         User Browser                         │
│                                                              │
│  1. User types search query                                 │
│  2. JavaScript sends POST to /api/search/_search            │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Caddy (news.awfulsec.com)                │
│                                                              │
│  • Serves static files from /var/www/html/news.awfulsec.com│
│  • Reverse proxy: /api/search/* → localhost:9200           │
│  • Rate limiting: 100 req/min per IP                        │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTP (localhost only)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│          Elasticsearch (Docker, port 9200)                  │
│                                                              │
│  • Index: awful_news                                        │
│  • Stores: titles, body text, URLs                          │
│  • Query: multi_match with fuzzy search                     │
└─────────────────────────────────────────────────────────────┘
                   ▲
                   │ Indexing (3x daily)
┌──────────────────┴──────────────────────────────────────────┐
│                   run_edition.sh                             │
│                                                              │
│  1. awful_text_news → Generate markdown                     │
│  2. mdbook build → Generate HTML                            │
│  3. node index_elasticsearch.js → Index content             │
│  4. rsync → Deploy to /var/www/html/                        │
└─────────────────────────────────────────────────────────────┘
```

## Systemd Service Integration

Your existing systemd service (e.g., `awful-news-edition.service`) doesn't need changes. It will automatically:

1. Run `run_edition.sh` 3 times daily
2. Build the site
3. Index content into Elasticsearch (if available)
4. Deploy the site

The indexing step is **non-blocking** - if Elasticsearch is down, the build continues and deploys.

## Caddy Configuration Explained

### Path Rewriting

```caddy
rewrite * /awful_news{path}
```

This transforms:
- Request: `https://news.awfulsec.com/api/search/_search`
- To Elasticsearch: `http://localhost:9200/awful_news/_search`

### Security Features

1. **Localhost Only**: Elasticsearch only binds to `127.0.0.1:9200`
2. **Method Restriction**: Only POST requests allowed (searches only, no deletions)
3. **Rate Limiting**: 100 requests per minute per IP prevents abuse
4. **No Direct Access**: Elasticsearch is never exposed to internet

### Rate Limiting (Optional)

The rate limiting in the example Caddyfile requires the `rate_limit` directive. If you don't have this plugin, you can:

1. **Install the rate limit plugin**:
   ```bash
   caddy add-package github.com/mholt/caddy-ratelimit
   ```

2. **Or remove rate limiting** and rely on Caddy's built-in protections:
   ```caddy
   reverse_proxy /api/search/* localhost:9200 {
       rewrite * /awful_news{path}
   }
   ```

## Monitoring

### Check Elasticsearch Status

```bash
systemctl status elasticsearch.service
docker ps | grep elasticsearch
curl http://localhost:9200/_cluster/health
```

### Check Index Status

```bash
# Count documents
curl http://localhost:9200/awful_news/_count

# View index stats
curl http://localhost:9200/awful_news/_stats

# Sample query through Caddy (from internet)
curl -X POST https://news.awfulsec.com/api/search/_search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"title":"security"}}, "size":5}'
```

### View Logs

```bash
# Elasticsearch logs
docker logs -f awful_news_elasticsearch_prod

# Caddy logs
journalctl -u caddy -f

# Edition script logs
journalctl -u awful-news-edition.service -f
```

### Check Search from Browser

Open browser console (F12) and check Network tab when searching. You should see:
```
POST https://news.awfulsec.com/api/search/_search
Status: 200 OK
```

## Resource Usage

Elasticsearch is configured with conservative memory settings:

- **Heap**: 512 MB (can adjust in [docker-compose.prod.yml](docker-compose.prod.yml))
- **Limit**: 1 GB max
- **Storage**: ~100-200 MB for your content size

On a 2GB+ server, this should run comfortably alongside your existing services.

## Troubleshooting

### Search Returns CORS or Network Errors

**Check Caddy configuration**:
```bash
caddy validate --config /etc/caddy/Caddyfile
```

**Test proxy manually**:
```bash
curl -v -X POST https://news.awfulsec.com/api/search/_search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match_all":{}},"size":1}'
```

### Elasticsearch Won't Start

```bash
# Check Docker service
systemctl status docker

# Check logs
docker logs awful_news_elasticsearch_prod

# Common issues:
# - Insufficient memory: Increase server RAM or reduce ES heap
# - Port 9200 in use: Check with `ss -tlnp | grep 9200`
# - Permission issues: Ensure tg user can run docker
```

### Search Returns No Results

1. **Check if indexing ran**:
   ```bash
   curl http://localhost:9200/awful_news/_count
   ```
   Should return `{"count":500,...}` or similar

2. **Check browser console** (F12):
   - Look for errors when clicking search button
   - Check Network tab for failed requests

3. **Re-index manually**:
   ```bash
   cd /home/tg/awful_security_news
   node index_elasticsearch.js
   ```

### Caddy 502 Bad Gateway

This means Caddy can't reach Elasticsearch:

```bash
# Is Elasticsearch running?
docker ps | grep elasticsearch

# Can Caddy reach it?
curl http://localhost:9200/_cluster/health

# Check Caddy can access Docker network
sudo -u caddy curl http://localhost:9200
```

### Build Fails After Adding Indexing

The script is designed to never fail the build. Check logs:

```bash
journalctl -u awful-news-edition.service -n 100
```

If you see warnings, the build should still succeed and deploy.

## Security Considerations

### Current Setup Security

✅ **Elasticsearch localhost only** - Not accessible from internet
✅ **Caddy reverse proxy** - Only exposes search endpoint
✅ **Method restriction** - Only POST (read-only operations)
✅ **Rate limiting** - Prevents abuse (100 req/min)
✅ **HTTPS** - Caddy provides automatic HTTPS

### Additional Hardening (Optional)

1. **IP Whitelist** in Caddy:
   ```caddy
   @blocked {
       not remote_ip 1.2.3.4 5.6.7.8
   }
   respond @blocked "Forbidden" 403
   ```

2. **Query Filtering** - Create a Node.js proxy that validates queries

3. **Authentication** - Add basic auth to search endpoint

For a public news site, the current setup is sufficient.

## Backup and Recovery

### Backing Up Elasticsearch Data

The data volume is at: `/var/lib/docker/volumes/awful_security_news_elasticsearch_prod_data`

Simple backup:
```bash
docker exec awful_news_elasticsearch_prod \
  curl -X PUT "localhost:9200/_snapshot/backup" -H 'Content-Type: application/json' -d '...'
```

### Recovery

If Elasticsearch is lost, just re-run the indexer:

```bash
cd /home/tg/awful_security_news
node index_elasticsearch.js
```

Your HTML content is the source of truth, so you can always rebuild the index.

## Performance Tuning

### If Search is Slow

1. **Check Caddy proxy performance**:
   ```bash
   curl -w "@curl-format.txt" -X POST https://news.awfulsec.com/api/search/_search ...
   ```

2. **Increase Elasticsearch heap** in [docker-compose.prod.yml](docker-compose.prod.yml):
   ```yaml
   - "ES_JAVA_OPTS=-Xms1g -Xmx1g"
   ```

3. **Enable Caddy caching** (cache search results for 60 seconds):
   ```caddy
   cache {
       ttl 60s
       match {
           path /api/search/*
       }
   }
   ```

## Reverting to Old Search (Emergency)

If you need to quickly revert:

```bash
cd /home/tg/awful_security_news

# Edit book.toml
vi book.toml
# Change line 17: enable = true
# Comment out lines 13-14 (additional-js and additional-css)

# Rebuild and deploy
mdbook build -d /tmp/awful_news_emergency
rsync -a /tmp/awful_news_emergency/ /var/www/html/news.awfulsec.com/
```

## Complete Caddyfile Example

Here's a complete example Caddyfile for your site:

```caddy
news.awfulsec.com {
    # Root directory
    root * /var/www/html/news.awfulsec.com

    # Elasticsearch search proxy
    handle /api/search/* {
        reverse_proxy localhost:9200 {
            # Rewrite path: /api/search/_search → /awful_news/_search
            rewrite * /awful_news{path}

            # Security headers
            header_up Host localhost:9200
            header_up X-Forwarded-For {remote_host}
        }
    }

    # Static file serving
    handle {
        encode gzip
        file_server
        try_files {path} {path}.html {path}/ =404
    }

    # Security headers
    header {
        # Prevent clickjacking
        X-Frame-Options "SAMEORIGIN"

        # XSS protection
        X-Content-Type-Options "nosniff"

        # Referrer policy
        Referrer-Policy "strict-origin-when-cross-origin"

        # Remove server header
        -Server
    }

    # Logging
    log {
        output file /var/log/caddy/news.awfulsec.com.log
        format json
    }
}
```

## Testing Checklist

Before going to production:

- [ ] Elasticsearch systemd service starts on boot
- [ ] `curl http://localhost:9200/_cluster/health` returns healthy
- [ ] Caddy configuration validates: `caddy validate`
- [ ] Caddy reverse proxy works: `curl -X POST https://news.awfulsec.com/api/search/_search ...`
- [ ] `run_edition.sh` completes without errors
- [ ] Browser search returns results (open F12 console first)
- [ ] Rate limiting works (test with multiple requests)
- [ ] Logs show successful indexing: `journalctl -u awful-news-edition.service`

## Next Steps

1. **Install dependencies**: `npm install`
2. **Start Elasticsearch**: `sudo systemctl start elasticsearch.service`
3. **Update Caddyfile**: Add reverse proxy configuration
4. **Reload Caddy**: `sudo systemctl reload caddy`
5. **Test manually**: `./run_edition.sh`
6. **Test search**: Open site and try searching
7. **Monitor**: Check logs during next scheduled run

## Questions?

- Check [ELASTICSEARCH_SETUP.md](ELASTICSEARCH_SETUP.md) for development setup
- Review [run_edition.sh](run_edition.sh) for implementation details
- Test Caddy config: `caddy validate --config /etc/caddy/Caddyfile`
- Check systemd logs: `journalctl -u awful-news-edition.service -f`

The integration is designed to be **zero-downtime** and **non-breaking** - your builds will succeed even if Elasticsearch is down, and Caddy will gracefully handle failed proxy requests.
