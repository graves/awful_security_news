#!/bin/bash
set -e

echo "==================================="
echo "Elasticsearch Search Setup"
echo "==================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js: https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✓${NC} All prerequisites are installed"
echo ""

# Install npm dependencies
echo "Installing npm dependencies..."
npm install
echo -e "${GREEN}✓${NC} Dependencies installed"
echo ""

# Start Elasticsearch
echo "Starting Elasticsearch..."
docker-compose up -d
echo -e "${GREEN}✓${NC} Elasticsearch started"
echo ""

# Wait for Elasticsearch to be ready
echo "Waiting for Elasticsearch to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if curl -s http://localhost:9200/_cluster/health &> /dev/null; then
        echo -e "${GREEN}✓${NC} Elasticsearch is ready"
        break
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo -e "${RED}Error: Elasticsearch failed to start${NC}"
    echo "Check logs with: docker-compose logs elasticsearch"
    exit 1
fi

echo ""

# Build the book
echo "Building the book..."
if ! command -v mdbook &> /dev/null; then
    echo -e "${YELLOW}Warning: mdbook is not installed${NC}"
    echo "Please install mdbook: https://rust-lang.github.io/mdBook/guide/installation.html"
    echo "Then run: mdbook build && npm run index"
    exit 0
fi

mdbook build
echo -e "${GREEN}✓${NC} Book built"
echo ""

# Index the content
echo "Indexing content into Elasticsearch..."
npm run index
echo -e "${GREEN}✓${NC} Content indexed"
echo ""

echo "==================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "==================================="
echo ""
echo "To start the development server:"
echo "  mdbook serve"
echo ""
echo "To view Elasticsearch logs:"
echo "  npm run elastic:logs"
echo ""
echo "To stop Elasticsearch:"
echo "  npm run elastic:stop"
echo ""
echo "See ELASTICSEARCH_SETUP.md for more details."
