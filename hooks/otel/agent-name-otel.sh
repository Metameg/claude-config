#!/bin/bash
# agent-name-otel.sh
# Hook: SubagentStart — fires when an agent is spawned.
# Reads the agent's name from its .md frontmatter and sends it
# as an OTEL log to the Sigmoz OTLP/HTTP endpoint.

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

if not agent_type:
    raise SystemExit(0)

# Resolve name from .md frontmatter; fall back to agent_type
agents_dir = os.path.expanduser("~/.claude/agents")
agent_name = agent_type

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

# Send OTLP/HTTP log to Sigmoz (port 4318 = HTTP, 4317 = gRPC)
base = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
url = re.sub(r':4317$', ':4318', base) + "/v1/logs"

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
                "body": {"stringValue": f"Agent spawned: {agent_name}"},
                "attributes": [
                    {"key": "agentname", "value": {"stringValue": agent_name}},
                    {"key": "event.name", "value": {"stringValue": "agent.spawned"}},
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
