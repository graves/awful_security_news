"use strict";

/**
 * Elasticsearch Search Integration for mdBook
 *
 * This script replaces the default mdBook search with Elasticsearch-powered search.
 * It maintains the same UI/UX as the original mdBook search interface.
 */

(function elasticsearchSearch() {
    // Configuration
    // Use relative URL so it goes through Caddy reverse proxy
    const ELASTICSEARCH_URL = '/search';
    const INDEX_NAME = 'awful_news';
    const SEARCH_DEBOUNCE_MS = 300;

    // State
    let searchTimeout = null;
    let currentQuery = '';

    // DOM Elements
    const searchToggle = document.getElementById('search-toggle');
    const searchWrapper = document.getElementById('search-wrapper');
    const searchbar = document.getElementById('searchbar');
    const searchResults = document.getElementById('searchresults');
    const searchResultsOuter = document.getElementById('searchresults-outer');
    const searchResultsHeader = document.getElementById('searchresults-header');

    if (!searchToggle || !searchWrapper) {
        console.warn('Search UI elements not found - search may be disabled');
        return;
    }

    /**
     * Perform search query against Elasticsearch
     */
    async function performSearch(query) {
        if (!query || query.trim().length < 2) {
            hideResults();
            return;
        }

        try {
            const response = await fetch(`${ELASTICSEARCH_URL}/${INDEX_NAME}/_search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: {
                        multi_match: {
                            query: query,
                            fields: ['title^3', 'body', 'breadcrumbs^2'],
                            type: 'best_fields',
                            fuzziness: 'AUTO'
                        }
                    },
                    highlight: {
                        fields: {
                            title: {
                                pre_tags: ['<mark>'],
                                post_tags: ['</mark>'],
                                number_of_fragments: 0
                            },
                            body: {
                                pre_tags: ['<mark>'],
                                post_tags: ['</mark>'],
                                fragment_size: 150,
                                number_of_fragments: 3
                            }
                        }
                    },
                    size: 50,
                    _source: ['title', 'url', 'breadcrumbs']
                })
            });

            if (!response.ok) {
                throw new Error(`Search request failed: ${response.status}`);
            }

            const data = await response.json();
            displayResults(query, data.hits.hits);
        } catch (error) {
            console.error('Search error:', error);
            displayError('Search is currently unavailable. Please try again later.');
        }
    }

    /**
     * Display search results in the UI
     */
    function displayResults(query, hits) {
        if (hits.length === 0) {
            displayNoResults(query);
            return;
        }

        // Update header
        searchResultsHeader.textContent = `${hits.length} result${hits.length !== 1 ? 's' : ''} for "${query}"`;

        // Clear previous results
        searchResults.innerHTML = '';

        // Add results
        hits.forEach(hit => {
            const source = hit._source;
            const highlight = hit.highlight || {};

            const li = document.createElement('li');
            li.className = 'search-result';

            // Create result link
            const link = document.createElement('a');
            link.href = path_to_root + source.url;
            link.className = 'search-result-link';

            // Title (use highlighted if available)
            const title = document.createElement('div');
            title.className = 'search-result-title';
            title.innerHTML = highlight.title ? highlight.title[0] : escapeHtml(source.title);
            link.appendChild(title);

            // Breadcrumbs
            if (source.breadcrumbs && source.breadcrumbs.trim()) {
                const breadcrumbs = document.createElement('div');
                breadcrumbs.className = 'search-result-breadcrumbs';
                breadcrumbs.textContent = source.breadcrumbs;
                link.appendChild(breadcrumbs);
            }

            // Preview (use highlighted body fragments)
            if (highlight.body && highlight.body.length > 0) {
                const preview = document.createElement('div');
                preview.className = 'search-result-preview';
                preview.innerHTML = highlight.body.join(' ... ');
                link.appendChild(preview);
            }

            li.appendChild(link);
            searchResults.appendChild(li);
        });

        // Show results
        searchResultsOuter.classList.remove('hidden');
    }

    /**
     * Display "no results" message
     */
    function displayNoResults(query) {
        searchResultsHeader.textContent = `No results for "${query}"`;
        searchResults.innerHTML = '';

        const li = document.createElement('li');
        li.className = 'search-result-no-results';
        li.textContent = 'No matching pages found. Try different keywords or check your spelling.';
        searchResults.appendChild(li);

        searchResultsOuter.classList.remove('hidden');
    }

    /**
     * Display error message
     */
    function displayError(message) {
        searchResultsHeader.textContent = 'Search Error';
        searchResults.innerHTML = '';

        const li = document.createElement('li');
        li.className = 'search-result-error';
        li.textContent = message;
        searchResults.appendChild(li);

        searchResultsOuter.classList.remove('hidden');
    }

    /**
     * Hide search results
     */
    function hideResults() {
        searchResultsOuter.classList.add('hidden');
        searchResults.innerHTML = '';
        searchResultsHeader.textContent = '';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Toggle search bar visibility
     */
    function toggleSearch() {
        if (searchWrapper.classList.contains('hidden')) {
            showSearch();
        } else {
            hideSearch();
        }
    }

    /**
     * Show search bar
     */
    function showSearch() {
        searchWrapper.classList.remove('hidden');
        searchToggle.setAttribute('aria-expanded', 'true');
        searchbar.focus();
    }

    /**
     * Hide search bar
     */
    function hideSearch() {
        searchWrapper.classList.add('hidden');
        searchToggle.setAttribute('aria-expanded', 'false');
        hideResults();
        searchbar.value = '';
        currentQuery = '';
    }

    /**
     * Handle search input with debouncing
     */
    function handleSearchInput(event) {
        const query = event.target.value.trim();

        // Clear previous timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        // Don't search for very short queries
        if (query.length < 2) {
            hideResults();
            return;
        }

        // Debounce search
        searchTimeout = setTimeout(() => {
            if (query !== currentQuery) {
                currentQuery = query;
                performSearch(query);
            }
        }, SEARCH_DEBOUNCE_MS);
    }

    /**
     * Handle keyboard shortcuts
     */
    function handleKeydown(event) {
        // 's' key to open search (when not in input)
        if (event.key === 's' && !event.ctrlKey && !event.metaKey &&
            event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
            event.preventDefault();
            showSearch();
        }

        // Escape key to close search
        if (event.key === 'Escape' && !searchWrapper.classList.contains('hidden')) {
            event.preventDefault();
            hideSearch();
        }

        // Enter key to go to first result
        if (event.key === 'Enter' && event.target === searchbar && searchResults.firstChild) {
            event.preventDefault();
            const firstLink = searchResults.firstChild.querySelector('a');
            if (firstLink) {
                window.location.href = firstLink.href;
            }
        }
    }

    // Event Listeners
    searchToggle.addEventListener('click', toggleSearch);
    searchbar.addEventListener('input', handleSearchInput);
    document.addEventListener('keydown', handleKeydown);

    // Close search when clicking outside
    document.addEventListener('click', (event) => {
        if (!searchWrapper.contains(event.target) &&
            !searchToggle.contains(event.target) &&
            !searchWrapper.classList.contains('hidden')) {
            hideSearch();
        }
    });

    // Mark search as ready
    window.search = {
        hasFocus: function() {
            return document.activeElement === searchbar;
        }
    };

    console.log('Elasticsearch search initialized');
})();
