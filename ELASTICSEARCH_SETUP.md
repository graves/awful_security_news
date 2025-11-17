# Elasticsearch Search Setup

This guide explains how to set up and use Elasticsearch search for the Awful Security News mdBook.

## Why Elasticsearch?

The default mdBook search uses a client-side search index that was 11.3 MB in size, causing mobile browsers to crash and refresh constantly due to memory constraints. Elasticsearch provides a server-side search solution that is:

- **Mobile-friendly**: No large JavaScript files loaded on the client
- **Fast**: Optimized search engine with powerful query capabilities
- **Scalable**: Can handle large amounts of content without browser limitations

## Prerequisites

- Docker and Docker Compose
- Node.js (v14 or higher)
- npm
- Caddy web server (for production)

## Local Development Setup

### 1. Install Dependencies

```bash
cd /path/to/awful_security_news
npm install
```

This will install:
- `jsdom` - For parsing HTML content
- `node-fetch` - For making HTTP requests to Elasticsearch

### 2. Start Elasticsearch

```bash
npm run elastic:start
```

Or manually:
```bash
docker-compose up -d
```

This will start Elasticsearch on `http://localhost:9200`. You can verify it's running:

```bash
curl http://localhost:9200/_cluster/health
```

You should see JSON output with `"status":"green"` or `"status":"yellow"`.

### 3. Build the Book

```bash
mdbook build
```

This will generate the HTML files in the `book/` directory with the custom Elasticsearch search integration.

### 4. Index the Content

```bash
npm run index
```

Or manually:
```bash
node index_elasticsearch.js
```

This script will:
1. Read all HTML files from the `book/` directory
2. Extract searchable content (titles, body text, breadcrumbs)
3. Index the content into Elasticsearch

You should see output like:
```
Starting Elasticsearch indexing...
Elasticsearch connection successful
Creating index: awful_news
Index created successfully
Found 500 HTML files to index
Indexed 10/500 documents...
Indexed 20/500 documents...
...
=== Indexing Complete ===
Successfully indexed: 500 documents
Errors: 0
```

### 5. Test Locally with Caddy

For local testing with the same setup as production, create a `Caddyfile.dev`:

```caddy
localhost:8080 {
    root * ./book
    file_server

    # Elasticsearch reverse proxy
    reverse_proxy /api/search/* localhost:9200 {
        rewrite * /awful_news{path}
    }

    encode gzip
    try_files {path} {path}.html {path}/ =404
}
```

Then run:
```bash
caddy run --config Caddyfile.dev
```

Open http://localhost:8080 and test the search functionality.

## Production Deployment

### Architecture

In production, your setup looks like this:

```
Browser (https://news.awfulsec.com)
    ↓
Caddy Web Server
    ├─→ Static files (/var/www/html/news.awfulsec.com)
    └─→ Reverse proxy (/api/search/* → localhost:9200)
           ↓
       Elasticsearch (Docker, localhost only)
```

### Step 1: Deploy Elasticsearch

On your production server:

```bash
cd /home/tg/awful_security_news

# Copy production Docker Compose config
cp docker-compose.prod.yml docker-compose.yml

# Start Elasticsearch
docker-compose up -d

# Verify it's running
curl http://localhost:9200/_cluster/health
```

**Important**: Elasticsearch binds to `127.0.0.1:9200` only - it's never exposed to the internet.

### Step 2: Configure Caddy Reverse Proxy

Add this to your Caddyfile for `news.awfulsec.com`:

```caddy
news.awfulsec.com {
    # Root directory
    root * /var/www/html/news.awfulsec.com

    # Elasticsearch search proxy
    # This forwards browser requests to localhost Elasticsearch
    handle /api/search/* {
        reverse_proxy localhost:9200 {
            # Rewrite: /api/search/_search → /awful_news/_search
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
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
}
```

**What this does**:
- Browser requests `https://news.awfulsec.com/api/search/_search`
- Caddy forwards to `http://localhost:9200/awful_news/_search`
- Elasticsearch never exposed to internet
- All traffic goes through HTTPS

Reload Caddy:
```bash
sudo systemctl reload caddy
```

### Step 3: Test the Proxy

Test that Caddy can reach Elasticsearch:

```bash
curl -X POST https://news.awfulsec.com/api/search/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"match_all": {}},
    "size": 1
  }'
```

You should see JSON results from Elasticsearch.

### Step 4: Install Node.js Dependencies

```bash
cd /home/tg/awful_security_news
npm install
```

### Step 5: Set Up Elasticsearch Systemd Service

Create a systemd service so Elasticsearch starts on boot:

```bash
sudo cp /home/tg/awful_security_news/elasticsearch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable elasticsearch.service
sudo systemctl start elasticsearch.service
```

Verify:
```bash
sudo systemctl status elasticsearch.service
```

### Step 6: Build and Index

Your existing `run_edition.sh` script now automatically indexes content after building. Run it:

```bash
cd /home/tg/awful_security_news
./run_edition.sh
```

Watch for these log messages:
```
[2025-11-17T16:30:00-0500] Building mdBook...
[2025-11-17T16:30:05-0500] Indexing content into Elasticsearch...
[2025-11-17T16:30:05-0500] Elasticsearch is available, indexing content...
[2025-11-17T16:30:10-0500] Elasticsearch indexing completed successfully
```

### Step 7: Verify Search Works

1. Open https://news.awfulsec.com in a browser
2. Click the search icon (magnifying glass) or press `s`
3. Type a search query (e.g., "security breach")
4. Results should appear automatically as you type

Open browser console (F12) and check:
- Network tab should show: `POST https://news.awfulsec.com/api/search/_search`
- Status should be: `200 OK`

## How It Works

### Request Flow

```
1. User types "security" in search box
   ↓
2. JavaScript (elasticsearch-search.js) sends:
   POST https://news.awfulsec.com/api/search/_search
   Body: {"query": {"multi_match": {"query": "security", ...}}}
   ↓
3. Caddy receives request at /api/search/_search
   ↓
4. Caddy rewrites to: localhost:9200/awful_news/_search
   ↓
5. Elasticsearch searches the awful_news index
   ↓
6. Results flow back: Elasticsearch → Caddy → Browser
   ↓
7. JavaScript displays results with highlighting
```

### Search Features

The implementation provides:
- **Multi-field search**: Searches titles (3x weight), body text, and breadcrumbs (2x weight)
- **Fuzzy matching**: Handles typos automatically (e.g., "securty" finds "security")
- **Highlighting**: Shows matching terms in **bold** in results
- **Context snippets**: Shows relevant excerpts with highlighted terms
- **Debouncing**: Waits 300ms before searching (prevents too many requests)
- **Keyboard shortcuts**: `s` to open, `Escape` to close, `Enter` for first result

### Security Considerations

✅ **Elasticsearch localhost only** - Never exposed to internet
✅ **HTTPS required** - All browser traffic encrypted
✅ **Read-only operations** - Caddy only forwards POST (search queries)
✅ **No authentication needed** - Public content, no sensitive data
✅ **Rate limiting optional** - Can add to Caddy if needed

### Advanced Caddy Configuration (Optional)

For additional security, add rate limiting:

```caddy
news.awfulsec.com {
    root * /var/www/html/news.awfulsec.com

    # Rate limiting for search (requires caddy-ratelimit plugin)
    rate_limit {
        zone search {
            key {remote_host}
            events 100
            window 1m
        }
    }

    handle /api/search/* {
        # Apply rate limit
        @rl_exceeded {
            expression {http.rate_limit.exceeded}
        }
        respond @rl_exceeded "Too Many Requests" 429

        reverse_proxy localhost:9200 {
            rewrite * /awful_news{path}

            # Only allow POST
            @not_post {
                not method POST
            }
            respond @not_post "Method Not Allowed" 405
        }
    }

    handle {
        encode gzip
        file_server
        try_files {path} {path}.html {path}/ =404
    }
}
```

This limits each IP to 100 search requests per minute.

## Usage

Once everything is set up, users can:

1. Click the search icon (magnifying glass) in the top navigation bar
2. Type their search query (minimum 2 characters)
3. Results appear automatically as they type (with 300ms debounce)
4. Press Enter or click a result to navigate to that page

### Keyboard Shortcuts

- `s` - Open search bar
- `Escape` - Close search bar
- `Enter` - Navigate to first result

## Maintenance

### Rebuilding the Index

Whenever you update the book content, you need to rebuild the index:

```bash
mdbook build && npm run index
```

You can add this to your build pipeline or CI/CD process.

### Viewing Elasticsearch Logs

```bash
npm run elastic:logs
```

Or:
```bash
docker-compose logs -f elasticsearch
```

### Stopping Elasticsearch

```bash
npm run elastic:stop
```

Or:
```bash
docker-compose down
```

## Troubleshooting

### Search Returns No Results

1. Check if Elasticsearch is running:
   ```bash
   curl http://localhost:9200/_cluster/health
   ```

2. Verify the index exists:
   ```bash
   curl http://localhost:9200/_cat/indices
   ```

3. Check if documents are indexed:
   ```bash
   curl http://localhost:9200/awful_news/_count
   ```

### Browser Console Errors

If you see CORS errors in the browser console:
1. Make sure Elasticsearch CORS is configured correctly
2. Check that the `ELASTICSEARCH_URL` in `elasticsearch-search.js` is correct
3. Verify Elasticsearch is accessible from the browser

### Mobile Page Refreshing

If you still experience page refreshing on mobile:
1. Verify the old `searchindex.js` file is not being loaded
2. Check that `[output.html.search] enable = false` is in `book.toml`
3. Clear your browser cache

## Architecture

### Components

1. **Docker Compose** (`docker-compose.yml`): Runs Elasticsearch locally
2. **Indexing Script** (`index_elasticsearch.js`): Extracts content from HTML and indexes it
3. **Search JavaScript** (`src/theme/elasticsearch-search.js`): Client-side search interface
4. **Search CSS** (`src/theme/elasticsearch-search.css`): Styles for search results
5. **Theme Template** (`src/theme/index.hbs`): Modified to always show search UI

### Search Features

- **Multi-field search**: Searches across titles (3x weight), body text, and breadcrumbs (2x weight)
- **Fuzzy matching**: Handles typos and spelling variations automatically
- **Highlighting**: Shows matching terms in bold in results
- **Context snippets**: Shows relevant excerpts from the page with highlighted search terms
- **Responsive**: Works on all device sizes

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run index` | Index the book content into Elasticsearch |
| `npm run elastic:start` | Start Elasticsearch with Docker Compose |
| `npm run elastic:stop` | Stop and remove Elasticsearch containers |
| `npm run elastic:logs` | View Elasticsearch logs |
| `npm run build` | Build the book and index content (convenience script) |

## Cost Considerations

For production deployments:
- **AWS Elasticsearch**: ~$13/month for t3.small.elasticsearch instance
- **Elastic Cloud**: Starting at $16/month for basic tier
- **Self-hosted**: Server costs only (requires maintenance)

## Alternative: Algolia

If you prefer a managed search solution, consider Algolia:
- Free tier: 10,000 records, 10,000 searches/month
- No infrastructure to manage
- Better performance and features
- Requires account signup

You can adapt the indexing script to work with Algolia's API.
