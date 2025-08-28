#!/bin/zsh

# Function to recursively convert .md files using mdcat and save to the corresponding location in book_directory
convert_md_files() {
    local src_directory="$1"
    local book_directory="$2"

    # Iterate over each item in the source directory
    for item in "$src_directory"/*; 
    do
        if [ -d "$item" ]; 
        then
            # Create the corresponding directory in the book_directory
            mkdir -p "$book_directory/$(basename "$item")"
            # If the item is a directory, recursively call this function
            convert_md_files "$item" "$book_directory/$(basename "$item")"
        elif [ -f "$item" ] && [[ "$item" == *.md ]]; 
        then
            base_name=$(basename "$item" .md)
            # Create a text file with the raw content of the .md file
            cat "$item" > "$book_directory/$base_name.md"
            echo "Raw content copied: $item to $book_directory/$base_name.md"

            # Convert the markdown file to a text file using mdcat
            mdcat "$item" > "$book_directory/$base_name.md.txt"
            echo "Converted: $item to $book_directory/$base_name.md.txt"
        fi
    done
}

# Function to recursively sign files in a directory
sign_files_in_directory() {
    local directory="$1"

    # Iterate over each item in the directory
    for item in "$directory"/*; 
    do
        echo "$item\n"
        
        if [ -d "$item" ]; 
        then
            # If the item is a directory, recursively call this function
            sign_files_in_directory "$item"
        elif [ -f "$item" ]; 
        then
            # Create a detached signature for the file
            gpg --output "$item.asc" --detach-sign "$item"
            echo "Signed: $item"
        fi
    done
}

# Write robots.txt file
write_robots() {
	local directory="$1"
	echo "User-agent: *
Disallow: 
Disallow: /assets
Disallow: /theme
Sitemap: https://news.awfulsec.com/sitemap.xml" > "$directory/robots.txt"
}

# Check if two directories were provided as arguments
if [ -z "$1" ] || [ -z "$2" ]; 
then
    echo "Usage: $0 <src_directory> <book_directory>"
    exit 1
fi

# Call the functions with the provided directories
mdbook build
write_robots "$2"
mdbook-sitemap-generator -d news.awfulsec.com -o book/sitemap.xml
convert_md_files "$1" "$2"
sign_files_in_directory "$2"
tar czvf website.tar.gz book
