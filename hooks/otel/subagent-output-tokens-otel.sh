#!/bin/bash
# subagent-output-tokens-otel.sh
# Hook: SubagentStop — fires when a subagent finishes.
# Parses the subagent transcript for output_tokens and sends the count
# as an OTEL log to the SigNoz OTLP/HTTP endpoint.

HOOK_INPUT=$(cat)

HOOK_INPUT="$HOOK_INPUT" \
OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}" \
python3 <<'PYEOF'
import json, os, re, urllib.request, time

try:
    payload = json.loads(os.environ.get("HOOK_INPUT", "{}"))
except Exception:
    raise SystemExit(0)

session_id = payload.get("session_id", "unknown")
agent_type = (payload.get("agent_type") or "").strip()
transcript  = (payload.get("agent_transcript_path") or payload.get("transcript_path") or "").strip()

if not transcript or not os.path.isfile(transcript):
    raise SystemExit(0)

# Resolve display name from .md frontmatter; fall back to agent_type
agents_dir = os.path.expanduser("~/.claude/agents")
agent_name = agent_type or "unknown"

if agent_type:
    for root, _, files in os.walk(agents_dir):
        for fname in files:
            if fname == f"{agent_type}.md":
                try:
                    content = open(os.path.join(root, fname)).read()
                    m = re.search(r'^name:\s*(.+)$', content, re.MULTILINE)
                    if m:
                        agent_name = m.group(1).strip()
                except Exception:
                    pass
                break

# Sum output_tokens across all transcript entries
output_tokens = 0
try:
    with open(transcript) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                u = e.get("usage") or e.get("message", {}).get("usage", {}) or {}
                output_tokens += u.get("output_tokens", 0)
            except Exception:
                continue
except Exception:
    raise SystemExit(0)

# Send OTLP/HTTP log to SigNoz (port 4318 = HTTP, 4317 = gRPC)
base = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
url  = re.sub(r':4317$', ':4318', base) + "/v1/logs"

log_payload = {
    "resourceLogs": [{
        "resource": {
            "attributes": [
                {"key": "service.name", "value": {"stringValue": "claude-code"}},
                {"key": "session.id",   "value": {"stringValue": session_id}},
            ]
        },
        "scopeLogs": [{
            "scope": {"name": "claude.agent"},
            "logRecords": [{
                "timeUnixNano": str(int(time.time() * 1e9)),
                "severityNumber": 9,
                "severityText": "INFO",
                "body": {"stringValue": f"Agent stopped: {agent_name} ({output_tokens} output tokens)"},
                "attributes": [
                    {"key": "agentname",     "value": {"stringValue": agent_name}},
                    {"key": "output_tokens", "value": {"intValue": output_tokens}},
                    {"key": "event.name",    "value": {"stringValue": "agent.stopped"}},
                ],
            }]
        }]
    }]
}

try:
    req = urllib.request.Request(
        url,
        data=json.dumps(log_payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2)
except Exception:
    pass  # never block on telemetry

PYEOF

exit 0
