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
  echo "создан .env из .env.example — заполните AI_DOCS_PATH и SPEC_* перед первым запуском"
fi

if [[ ! -f .gigacode/GIGACODE.local.md ]]; then
  cp .gigacode/GIGACODE.local.md.example .gigacode/GIGACODE.local.md
  echo "создан .gigacode/GIGACODE.local.md — впишите адрес Nexus, без него шаг с версиями не выполнится"
fi

echo "installing tool-server dependencies…"
( cd tools-server && npm install --no-audit --no-fund )

echo "building tool server…"
( cd tools-server && npm run build )

echo "checking .gigacode configuration…"
( cd tools-server && npm run check --silent ) || echo "  ^ поправьте конфигурацию перед запуском агента"

echo
set -a; [[ -f .env ]] && source .env; set +a
DOCS="${AI_DOCS_PATH:-ai-docs}"
[[ "$DOCS" = /* ]] || DOCS="$PWD/$DOCS"
if [[ -d "$DOCS" ]]; then
  echo "knowledge base: $(find "$DOCS" -name '*.md' -not -path '*/.git/*' | wc -l | tr -d ' ') documents at $DOCS"
else
  echo "knowledge base: НЕ НАЙДЕНА по пути $DOCS"
  echo "  укажите AI_DOCS_PATH в .env, либо задайте AI_DOCS_GIT_URL и выполните ./scripts/sync-ai-docs.sh"
  echo "  подробно: docs/connecting-ai-docs.md"
fi
echo "agent tools:    $(ls tools-server/dynamic/*.tool.ts 2>/dev/null | wc -l | tr -d ' ') agent-authored"
echo
echo "next: ./scripts/run-agent.sh BACK-1234 456"
