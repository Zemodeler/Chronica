#!/bin/bash
# empties.sh <hash>...: answer these compose_chronicle prompts {"entries":[]} -- by hand, after you read them: far-off news that is nobody's business,
# a matter that has only gone on, a headline already told. Logs the hashes to <run>/notes.log so the report can count them.
ROOT=$(git rev-parse --show-toplevel); RUNDIR=$ROOT/apps/web/eval-out/${RUN:-ui-run3}
cd "$RUNDIR/hand" || exit 1
for h in "$@"; do echo '{"entries":[]}' > compose_chronicle-$h.json; done
echo "empties hand-written: $*" >> "$RUNDIR/notes.log"
