#!/bin/bash
# waitp.sh [seconds]: wait for an unanswered prompt, print the list, exit. Keep each wait under the tool timeout.
DIR=$(cd "$(dirname "$0")" && pwd)
for i in $(seq 1 $(( ${1:-90} / 3 ))); do
  out=$("$DIR/pending.sh"); [ -n "$out" ] && { echo "$out"; exit 0; }
  sleep 3
done
echo "none pending after ${1:-90}s"
