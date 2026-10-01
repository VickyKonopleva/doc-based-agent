#!/usr/bin/env bash
# One-time setup: dependencies, build, .env, sanity check.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( node_major < 20 )); then
  echo "error: Node 20+ required, found $(node -v 2>/dev/null || echo 'nothing')" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example — fill in JIRA_* and VCS_* before the first run"
fi

echo "installing tool-server dependencies…"
( cd tools-server && npm install --no-audit --no-fund )

echo "building tool server…"
( cd tools-server && npm run build )

echo
echo "knowledge base: $(find ai-docs -name '*.md' | wc -l | tr -d ' ') documents"
echo "agent tools:    $(ls tools-server/dynamic/*.tool.ts 2>/dev/null | wc -l | tr -d ' ') agent-authored"
echo
echo "next: ./scripts/run-agent.sh BACK-1234"
