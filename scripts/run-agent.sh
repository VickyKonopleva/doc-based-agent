#!/usr/bin/env bash
# Run the backend-developer agent on a single Jira ticket.
#
#   ./scripts/run-agent.sh BACK-1234
#   ./scripts/run-agent.sh BACK-1234 --plan      # analysis only, no edits
#
# The tool server is started by GigaCode itself through .gigacode/settings.json;
# this script only resolves the workspace and hands over the ticket.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TICKET="${1:-}"
MODE="${2:-}"

if [[ -z "$TICKET" ]]; then
  echo "usage: $0 <TICKET-123> [--plan]" >&2
  exit 2
fi

if ! [[ "$TICKET" =~ ^[A-Z][A-Z0-9_]+-[0-9]+$ ]]; then
  echo "error: '$TICKET' does not look like a Jira key (expected e.g. BACK-1234)" >&2
  exit 2
fi

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a; source "$PROJECT_ROOT/.env"; set +a
fi

WORKSPACE_PATH="${WORKSPACE_PATH:-$PROJECT_ROOT}"
export WORKSPACE_PATH

if [[ ! -d "$WORKSPACE_PATH" ]]; then
  echo "error: WORKSPACE_PATH='$WORKSPACE_PATH' does not exist — point it at the service checkout" >&2
  exit 1
fi

COMMAND="/ticket $TICKET"
[[ "$MODE" == "--plan" ]] && COMMAND="/plan $TICKET"

echo "[run-agent] workspace: $WORKSPACE_PATH" >&2
echo "[run-agent] command:   $COMMAND" >&2

# GIGACODE_BIN lets you point at a specific CLI build.
GIGACODE_BIN="${GIGACODE_BIN:-gigacode}"

if ! command -v "$GIGACODE_BIN" >/dev/null 2>&1; then
  echo "error: '$GIGACODE_BIN' not found in PATH. Set GIGACODE_BIN to the CLI binary." >&2
  exit 127
fi

cd "$PROJECT_ROOT"
exec "$GIGACODE_BIN" --agent backend-developer "$COMMAND"
