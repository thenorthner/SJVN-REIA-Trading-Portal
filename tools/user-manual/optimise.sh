#!/bin/zsh
# Makes smaller copies of the screenshots in shots-opt/ (max 1500 px wide, 255 colours).
cd "$(dirname "$0")"; mkdir -p shots-opt
for f in shots/[0-9]*.png; do o=shots-opt/$(basename $f); [ $o -nt $f ] || magick $f -resize '1500x>' -strip -dither None -colors 255 PNG8:$o; done
