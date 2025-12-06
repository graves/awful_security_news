#!/usr/bin/env node

/**
 * Elasticsearch Indexing Script for mdBook
 *
 * This script reads the built HTML files from the mdBook output directory,
 * extracts searchable content, and indexes it into Elasticsearch.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');

// Configuration
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'awful_news';
const BOOK_DIR = process.env.BOOK_DIR || '/var/www/html/news.awfulsec.com';

/**
 * Create or update the Elasticsearch index with proper mappings
 */
async function createIndex() {
  const indexConfig = {
    settings: {
      analysis: {
        analyzer: {
          content_analyzer: {
            type: 'standard',
            stopwords: '_english_'
          }
        }
      }
    },
    mappings: {
      properties: {
        url: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'content_analyzer',
          fields: {
            keyword: { type: 'keyword' }
          }
        },
        body: {
          type: 'text',
          analyzer: 'content_analyzer'
        },
        breadcrumbs: { type: 'text' },
        section: { type: 'keyword' }
      }
    }
  };

  try {
    // Check if index exists
    const checkResponse = await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}`);

    if (checkResponse.ok) {
      // Delete existing index
      console.log(`Deleting existing index: ${INDEX_NAME}`);
      await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}`, { method: 'DELETE' });
    }

    // Create new index
    console.log(`Creating index: ${INDEX_NAME}`);
    const createResponse = await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(indexConfig)
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create index: ${await createResponse.text()}`);
    }

    console.log('Index created successfully');
  } catch (error) {
    console.error('Error creating index:', error.message);
    throw error;
  }
}

/**
 * Extract text content from HTML, excluding navigation and script elements
 */
function extractContent(html, url) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove elements we don't want to index
  const elementsToRemove = document.querySelectorAll(
    'script, style, nav, .nav-chapters, #sidebar, #menu-bar, .fa, .buttons'
  );
  elementsToRemove.forEach(el => el.remove());

  // Extract title
  const titleElement = document.querySelector('h1, .menu-title');
  const title = titleElement ? titleElement.textContent.trim() : path.basename(url, '.html');

  // Extract breadcrumbs if available
  const breadcrumbsElement = document.querySelector('.breadcrumbs');
  const breadcrumbs = breadcrumbsElement ? breadcrumbsElement.textContent.trim() : '';

  // Extract main content
  const contentElement = document.querySelector('#content main, #content, main, body');
  const body = contentElement ? contentElement.textContent.trim() : '';

  // Extract section (for categorization)
  const section = url.includes('2025-') ? 'daily_news' : 'general';

  return {
    url: url.replace(/^.*\/book\//, ''),
    title,
    breadcrumbs,
    body: body.replace(/\s+/g, ' ').trim(),
    section
  };
}

/**
 * Recursively find all HTML files in a directory
 */
function findHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findHtmlFiles(filePath, fileList);
    } else if (file.endsWith('.html') && !file.startsWith('print.html')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Index a document into Elasticsearch
 */
async function indexDocument(doc, docId) {
  const response = await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}/_doc/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc)
  });

  if (!response.ok) {
    throw new Error(`Failed to index document ${docId}: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Main indexing function
 */
async function indexContent() {
  console.log('Starting Elasticsearch indexing...');

  // Check if Elasticsearch is available
  try {
    const healthResponse = await fetch(`${ELASTICSEARCH_URL}/_cluster/health`);
    if (!healthResponse.ok) {
      throw new Error('Elasticsearch is not available');
    }
    console.log('Elasticsearch connection successful');
  } catch (error) {
    console.error('Error connecting to Elasticsearch:', error.message);
    console.error('Make sure Elasticsearch is running (try: docker-compose up -d)');
    process.exit(1);
  }

  // Create/recreate index
  await createIndex();

  // Find all HTML files
  const htmlFiles = findHtmlFiles(BOOK_DIR);
  console.log(`Found ${htmlFiles.length} HTML files to index`);

  // Index each file
  let indexed = 0;
  let errors = 0;

  for (const filePath of htmlFiles) {
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(BOOK_DIR, filePath);
      const doc = extractContent(html, relativePath);

      // Use URL as document ID (sanitized)
      const docId = doc.url.replace(/[^a-zA-Z0-9_-]/g, '_');

      await indexDocument(doc, docId);
      indexed++;

      if (indexed % 10 === 0) {
        console.log(`Indexed ${indexed}/${htmlFiles.length} documents...`);
      }
    } catch (error) {
      console.error(`Error indexing ${filePath}:`, error.message);
      errors++;
    }
  }

  console.log('\n=== Indexing Complete ===');
  console.log(`Successfully indexed: ${indexed} documents`);
  console.log(`Errors: ${errors}`);

  // Refresh index to make documents searchable immediately
  await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}/_refresh`, { method: 'POST' });
  console.log('Index refreshed - documents are now searchable');
}

// Run the indexing
if (require.main === module) {
  indexContent()
    .then(() => {
      console.log('Indexing completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { indexContent, createIndex, extractContent };
