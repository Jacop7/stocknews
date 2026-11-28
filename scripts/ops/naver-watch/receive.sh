#!/bin/sh
# Forced command for the sector-move upload key (docs/sector-news-plan.md §3.5). Installed as
# /home/ubuntu/.local/share/judoju-ai/market/receive.sh (ubuntu, 0755). Reads at most 32 KiB from standard input,
# writes it to a temporary file in the same folder (0640) and atomically replaces sector-moves.json. Takes no
# arguments and ignores SSH_ORIGINAL_COMMAND. The AI processor validates the content before using it.
set -eu
umask 027
dir=/home/ubuntu/.local/share/judoju-ai/market
target="$dir/sector-moves.json"
[ -d "$dir" ] && [ ! -L "$dir" ] || { echo NO_MARKET_DIR >&2; exit 3; }
[ ! -L "$target" ] || { echo TARGET_IS_LINK >&2; exit 3; }
[ ! -e "$target" ] || [ -f "$target" ] || { echo TARGET_NOT_FILE >&2; exit 3; }
tmp=$(mktemp "$dir/.incoming.XXXXXXXX")
trap 'rm -f "$tmp"' EXIT
head -c 32769 > "$tmp"
size=$(wc -c < "$tmp")
[ "$size" -gt 0 ] && [ "$size" -le 32768 ] || { echo SIZE >&2; exit 4; }
chmod 0640 "$tmp"
mv -f "$tmp" "$target"
trap - EXIT
echo OK
