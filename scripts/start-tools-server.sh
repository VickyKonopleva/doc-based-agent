#!/usr/bin/env bash
# Ручной запуск сервера инструментов по stdio — для отладки.
#
# GigaCode запускает сервер сам, по .gigacode/settings.json:
#   "be-tools": { "command": "npx", "args": ["tsx", "src/index.ts"], "cwd": "tools-server" }
# Этот скрипт нужен, только если вы хотите поднять сервер отдельно
# (например, под MCP Inspector) или прогнать его из другого каталога.
#
# Всё, что печатается здесь, идёт в stderr: stdout занят JSON-RPC.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/tools-server"

log() { printf '[be-tools] %s\n' "$*" >&2; }

cd "$SERVER_DIR"

if [[ ! -d node_modules ]]; then
  log "устанавливаю зависимости…"
  npm ci --silent >&2 || npm install --silent >&2
fi

# Сервер сам читает .env из корня проекта (src/lib/config.ts),
# поэтому переменные здесь не пробрасываются.
if [[ "${TOOLS_SERVER_DEV:-0}" == "1" ]]; then
  log "dev-режим (tsx, горячая перезагрузка)"
  exec npx tsx watch src/index.ts
fi

if [[ ! -f dist/index.js ]] || [[ -n "$(find src -name '*.ts' -newer dist/index.js -print -quit 2>/dev/null)" ]]; then
  log "собираю…"
  npm run build --silent >&2
fi

log "старт"
exec node dist/index.js
