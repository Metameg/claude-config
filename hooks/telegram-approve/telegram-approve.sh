#!/bin/bash
# telegram-approve.sh <command>
# Sends an Approve/Deny prompt to Telegram and blocks (self-bounded) for the tap.
# Exit 0 = approved; exit 1 = denied/timeout/unreachable (fail-closed).
# Test stub: TG_TEST_DECISION in {approve,deny,timeout} short-circuits the network.
set -uo pipefail

cmd="${1:-}"
reqid="$(printf '%s|%s' "$cmd" "$RANDOM$RANDOM" | sha256sum | cut -c1-12)"
summary="req $reqid | cwd $(basename "$PWD") | $(printf '%s' "$cmd" | cut -c1-60)"

# --- test stub -----------------------------------------------------------
if [ -n "${TG_TEST_DECISION:-}" ]; then
  case "$TG_TEST_DECISION" in
    approve) exit 0 ;;
    *)       exit 1 ;;
  esac
fi
# -------------------------------------------------------------------------

CFG="$HOME/.claude/.env"
[ -f "$CFG" ] || { echo "~/.claude/.env missing" >&2; exit 1; }
source "$CFG"
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || { echo "telegram not configured" >&2; exit 1; }
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

kb=$(jq -n --arg a "approve:$reqid" --arg d "deny:$reqid" \
  '{inline_keyboard:[[{text:"✅ Approve",callback_data:$a},{text:"⛔ Deny",callback_data:$d}]]}')
msg_id=$(curl -s "$API/sendMessage" \
  --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
  --data-urlencode "text=🔐 Approve command?\n$summary" \
  --data-urlencode "reply_markup=$kb" | jq -r '.result.message_id // empty')
[ -n "$msg_id" ] || { echo "sendMessage failed" >&2; exit 1; }

# Self-bounded poll: ~1 hr total (3600s), 5s per long-poll.
offset=0; deadline=$(( $(date +%s) + 3600 )); decision=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  updates=$(curl -s "$API/getUpdates" --data-urlencode "timeout=5" --data-urlencode "offset=$offset")
  while read -r data uid; do
    [ -z "$uid" ] && continue
    offset=$(( uid + 1 ))
    case "$data" in
      "approve:$reqid") decision=approve ;;
      "deny:$reqid")    decision=deny ;;
    esac
  done < <(printf '%s' "$updates" | jq -r '.result[]? | select(.callback_query) | "\(.callback_query.data) \(.update_id)"')
  [ -n "$decision" ] && break
done

case "$decision" in
  approve) curl -s "$API/editMessageText" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "message_id=$msg_id" --data-urlencode "text=✅ Approved\n$summary" >/dev/null; exit 0 ;;
  deny)    curl -s "$API/editMessageText" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "message_id=$msg_id" --data-urlencode "text=⛔ Denied\n$summary" >/dev/null; exit 1 ;;
  *)       curl -s "$API/editMessageText" --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "message_id=$msg_id" --data-urlencode "text=⌛ Expired\n$summary" >/dev/null; exit 1 ;;
esac
