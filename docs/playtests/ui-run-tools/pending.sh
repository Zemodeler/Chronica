#!/bin/bash
# Lists model prompts nobody has answered yet. Run from anywhere; HAND overrides the hand directory.
HAND=${HAND:-$(git rev-parse --show-toplevel)/apps/web/eval-out/ui-run/hand}
cd "$HAND" || exit 1
shopt -s nullglob
for p in *.prompt.txt; do b=${p%.prompt.txt}; [ -f "$b.json" ] || echo "$b  $(wc -c < "$p")B  $(head -c 60 "$p" | tr '\n' ' ')"; done
