#!/usr/bin/env bash
# Switch the Jira source: external MCP connector (default of this script)
# or the local ts tool server.
#
#   ./scripts/use-jira-mcp.sh external
#   ./scripts/use-jira-mcp.sh local
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-external}"
SETTINGS="$PROJECT_ROOT/.gigacode/settings.json"

case "$MODE" in
  external)
    cp "$PROJECT_ROOT/.gigacode/settings.jira-mcp.json" "$SETTINGS"
    echo "settings.json now uses the external Jira MCP connector."
    echo "Set JIRA_PROVIDER=external in .env so ai-tools stops exposing jira_get_issue."
    ;;
  local)
    cp "$PROJECT_ROOT/.gigacode/settings.local-jira.json" "$SETTINGS"
    echo "settings.json now uses jira_get_issue from the local ts tool server."
    echo "Set JIRA_PROVIDER=local, JIRA_BASE_URL and JIRA_TOKEN in .env."
    ;;
  *)
    echo "usage: $0 [external|local]" >&2
    exit 2
    ;;
esac
