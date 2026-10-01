#!/usr/bin/env bash
# Launch the MCP tool server over stdio.
#
# Registered in .gigacode/settings.json. Everything this script prints MUST go
# to stderr: stdout belongs to the JSON-RPC stream.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/tools-server"

log() { printf '[tools-server] %s\n' "$*" >&2; }

# Secrets live in .env, never in settings.json.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
  log "loaded $PROJECT_ROOT/.env"
else
  log "no .env found — relying on the inherited environment (copy .env.example to .env)"
fi

export AI_DOCS_PATH="${AI_DOCS_PATH:-$PROJECT_ROOT/ai-docs}"
export TOOLS_DYNAMIC_DIR="${TOOLS_DYNAMIC_DIR:-$SERVER_DIR/dynamic}"
export WORKSPACE_PATH="${WORKSPACE_PATH:-$PROJECT_ROOT}"

cd "$SERVER_DIR"

if [[ ! -d node_modules ]]; then
  log "installing dependencies…"
  npm ci --silent >&2 || npm install --silent >&2
fi

# Dev mode: run TypeScript directly, reload on change.
if [[ "${TOOLS_SERVER_DEV:-0}" == "1" ]]; then
  log "starting in dev mode (tsx)"
  exec npx tsx src/index.ts
fi

if [[ ! -f dist/index.js ]] || [[ -n "$(find src -name '*.ts' -newer dist/index.js -print -quit 2>/dev/null)" ]]; then
  log "building…"
  npm run build --silent >&2
fi

log "starting (ai-docs=$AI_DOCS_PATH, workspace=$WORKSPACE_PATH, jira=${JIRA_PROVIDER:-local})"
exec node dist/index.js
