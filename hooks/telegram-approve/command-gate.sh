#!/bin/bash
# command-gate.sh — PreToolUse(Bash) approval gate.
# Decisions: allow (silent), deny (block), ask (harness prompt), or remote (Telegram).
set -uo pipefail
HOOK_DIR="$HOME/.claude/hooks/telegram-approve"
source "$HOOK_DIR/classify.sh"

emit() {  # $1=decision $2=reason
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":%s}}\n' \
    "$1" "$(jq -Rn --arg r "$2" '$r')"
}
allow() { printf '{}'; exit 0; }  # no permissionDecision field => defer to normal permission flow

input="$(cat)"
# Fail closed on an unparseable payload — never silently allow.
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  emit deny "command-gate: unparseable hook payload"
  exit 0
fi
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
mode="$(printf '%s' "$input" | jq -r '.permission_mode // "default"')"
[ -z "$cmd" ] && allow

class="$(classify "$cmd")"
case "$class" in
  none)         allow ;;
  test_wrapped) allow ;;
  test_raw)
    emit deny "Test runs must go through the scrubber. Re-run as: safe-test $cmd"
    exit 0 ;;
  important)
    # Read only FORCE_REMOTE_APPROVAL from the conf file (avoid sourcing arbitrary code).
    conf="$HOME/.claude/command-gate.conf"
    force_remote=0
    if [ -f "$conf" ] && grep -Eq '^[[:space:]]*FORCE_REMOTE_APPROVAL[[:space:]]*=[[:space:]]*1' "$conf"; then
      force_remote=1
    fi
    bypass=0
    [ "$mode" = "bypassPermissions" ] && bypass=1
    [ "$force_remote" = "1" ] && bypass=1

    if [ "$bypass" = "1" ]; then
      helper="$HOOK_DIR/telegram-approve.sh"
      if [ "${CMDGATE_NO_TELEGRAM:-0}" = "1" ] || [ ! -f "$HOME/.claude/.env" ] || [ ! -x "$helper" ]; then
        emit deny "Important command blocked in bypass mode (no approval channel configured): $cmd"
        exit 0
      fi
      if bash "$helper" "$cmd" 2>/dev/null; then
        emit allow "Approved via Telegram."   # explicit allow: we have human consent (valid PreToolUse decision; avoids double-prompt in FORCE_REMOTE normal mode)
      else
        emit deny "Denied or timed out via Telegram."
      fi
      exit 0
    fi
    emit ask "Important command ($class) — approve?"
    exit 0 ;;
  *)
    emit deny "command-gate: unrecognized command class '$class'"
    exit 0 ;;
esac
allow
