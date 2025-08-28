#!/bin/bash

set -e

# Write robots.txt file
write_robots() {
	local directory="$1"
	echo "User-agent: *
Disallow: 
Disallow: /assets
Disallow: /theme
Sitemap: https://news.awfulsec.com/sitemap.xml" > "$directory/robots.txt"
}

mkdir -p api_out
awful_text_news --json-output-dir api_out --markdown-output-dir src
mdbook build -d daily_news
write_robots "$2"
mdbook-sitemap-generator -d news.awfulsec.com -o book/sitemap.xml
cp -r api_out/* /var/www/html/news.awfulsec.com/api/
cp -r daily_news/* /var/www/html/news.awfulsec.com/
chown -R caddy:caddy /var/www/html/news.awfulsec.com
rm -rf api_out
