# Multi-stage Dockerfile for Awful Security News
# Stage 1: Build environment with Rust tools
FROM rust:1.75-bookworm AS rust-builder

# Install mdbook and sitemap generator
RUN cargo install mdbook mdbook-sitemap-generator

# Stage 2: Runtime with all necessary tools
FROM debian:bookworm-slim AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    rsync \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust binaries from builder
COPY --from=rust-builder /usr/local/cargo/bin/mdbook /usr/local/bin/
COPY --from=rust-builder /usr/local/cargo/bin/mdbook-sitemap-generator /usr/local/bin/

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
