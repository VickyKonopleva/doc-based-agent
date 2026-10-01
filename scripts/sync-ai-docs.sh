#!/usr/bin/env bash
# Клонировать или обновить базу знаний из git.
#
#   ./scripts/sync-ai-docs.sh
#
# Берёт AI_DOCS_GIT_URL, AI_DOCS_REF и AI_DOCS_PATH из .env.
# Если вы работаете с уже существующим локальным чекаутом, этот скрипт не нужен:
# достаточно указать на него AI_DOCS_PATH.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$PROJECT_ROOT/.env" ]] && { set -a; source "$PROJECT_ROOT/.env"; set +a; }

URL="${AI_DOCS_GIT_URL:-}"
REF="${AI_DOCS_REF:-master}"
DEST="${AI_DOCS_PATH:-$PROJECT_ROOT/ai-docs}"
[[ "$DEST" = /* ]] || DEST="$PROJECT_ROOT/$DEST"

if [[ -z "$URL" ]]; then
  cat >&2 <<MSG
AI_DOCS_GIT_URL не задан в .env.

База знаний живёт вне этого репозитория. Либо укажите путь к существующему
чекауту:

    AI_DOCS_PATH=/Users/me/work/ai-docs

либо задайте адрес репозитория и повторите:

    AI_DOCS_GIT_URL=git@git.company.ru:ai/ai-docs.git
    AI_DOCS_REF=master
MSG
  exit 2
fi

if [[ -d "$DEST/.git" ]]; then
  echo "обновляю $DEST ($REF)"
  git -C "$DEST" fetch --quiet origin "$REF"
  git -C "$DEST" checkout --quiet "$REF"
  git -C "$DEST" pull --quiet --ff-only origin "$REF"
elif [[ -e "$DEST" ]]; then
  echo "error: $DEST существует, но это не git-репозиторий — разберитесь вручную" >&2
  exit 1
else
  echo "клонирую $URL → $DEST ($REF)"
  git clone --quiet --branch "$REF" "$URL" "$DEST"
fi

COUNT="$(find "$DEST" -name '*.md' -not -path '*/.git/*' | wc -l | tr -d ' ')"
echo "готово: $COUNT документов в $DEST"
[[ -f "$DEST/INDEX.md" ]] || echo "подсказка: в корне базы нет INDEX.md — агент будет ориентироваться только по каталогу и поиску" >&2
