#!/bin/bash

set -e

[ "$(id -u)" != 0 ] && exec sudo "$0"

mkdir -p api_out
awful_text_news --json-output-dir api_out --markdown-output-dir src
mdbook build -d daily_news
cp -r api_out/* /var/www/html/news.awfulsec.com/api/
cp -r daily_news/* /var/www/html/news.awfulsec.com/
chown -R caddy:caddy /var/www/html/news.awfulsec.com
rm -rf api_out
