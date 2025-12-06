# Dockerfile for Awful Security News
# Only needs Node.js for Elasticsearch indexing
# mdbook/sitemap tools are bind-mounted from host

FROM node:18-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -s /bin/bash appuser

# Create directories
RUN mkdir -p /app /output/site /output/api /output/viz \
    && chown -R appuser:appuser /app /output

WORKDIR /app

# Copy package files first for better caching
COPY --chown=appuser:appuser package*.json ./

# Install Node.js dependencies
USER appuser
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Copy application files
COPY --chown=appuser:appuser . .

# Default command
CMD ["bash", "-c", "echo 'Use docker compose to run services'"]
