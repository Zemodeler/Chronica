#!/bin/bash
# wp.sh [polls]: wait (3 s a poll, default 28) for an unanswered prompt, print it, exit. RUN names the run directory under apps/web/eval-out (default ui-run3).
# IGNORE (optional) is a prompt stem to leave out of the list, e.g. a declare_character prompt whose cached answer failed.
ROOT=$(git rev-parse --show-toplevel)
export HAND=$ROOT/apps/web/eval-out/${RUN:-ui-run3}/hand
for i in $(seq 1 ${1:-28}); do
  out=$(bash "$ROOT/docs/playtests/ui-run-tools/pending.sh" | grep -v "${IGNORE:-^$}"); [ -n "$out" ] && { echo "$out"; exit 0; }
  sleep 3
done
echo none
