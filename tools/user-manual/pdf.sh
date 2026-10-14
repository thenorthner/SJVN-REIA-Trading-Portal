#!/bin/zsh
# pdf.sh <file.docx>  — renders a Word file to PDF through Pages, to check the layout
f="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
osascript -e 'tell application "Pages"
open POSIX file "'"$f"'"
delay '"${2:-12}"'
set d to front document
export d to POSIX file "'"${f%.docx}.pdf"'" as PDF
close d saving no
end tell'
