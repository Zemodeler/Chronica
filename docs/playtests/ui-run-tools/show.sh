#!/bin/bash
# show.sh: print the facts of every unanswered compose/cognition prompt, trimmed. W sets the line width.
HAND=${HAND:-$(git rev-parse --show-toplevel)/apps/web/eval-out/ui-run/hand}
DIR=$(cd "$(dirname "$0")" && pwd)
cd "$HAND" || exit 1
for f in $("$DIR/pending.sh" | awk '{print $1}'); do
  echo "## ${f#compose_chronicle-}"
  sed -n '/^THREAD/,$p' "$f.prompt.txt" 2>/dev/null | grep -v '^$\|^The people in it\|the one whose reign' | cut -c1-${W:-380}
done
