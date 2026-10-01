#!/usr/bin/env bash
# Run the backend-developer agent on one task.
#
#   ./scripts/run-agent.sh BACK-1234 456            # тикет + PR аналитики
#   ./scripts/run-agent.sh BACK-1234 456 --plan     # только разбор и план
#   ./scripts/run-agent.sh BACK-1234 --no-spec      # хотфикс без спецификации
#
# Спецификация (PR в репозитории аналитики) — источник требований, тикет —
# контекст. Поэтому PR обязателен, а отказ от него явный и попадает в MR.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat >&2 <<'USAGE'
usage: run-agent.sh <TICKET-123> <PR аналитики> [--plan]
       run-agent.sh <TICKET-123> --no-spec [--plan]
       run-agent.sh --spec <PR аналитики>            # только разбор спецификации
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage

# Разбор спецификации без тикета
if [[ "$1" == "--spec" ]]; then
  [[ $# -ge 2 ]] || usage
  COMMAND="/spec $2"
  TICKET=""
else
  TICKET="$1"; shift
  [[ "$TICKET" =~ ^[A-Z][A-Z0-9_]+-[0-9]+$ ]] || {
    echo "error: '$TICKET' не похож на ключ Jira (ожидается, например, BACK-1234)" >&2; usage; }

  SPEC_PR=""
  NO_SPEC=0
  PLAN=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --plan)    PLAN=1 ;;
      --no-spec) NO_SPEC=1 ;;
      -*)        echo "error: неизвестный флаг '$1'" >&2; usage ;;
      *)         SPEC_PR="$1" ;;
    esac
    shift
  done

  if [[ -z "$SPEC_PR" && $NO_SPEC -eq 0 ]]; then
    echo "error: не указан PR в репозитории аналитики." >&2
    echo "       Процесс spec-driven: требования берутся из PR аналитики." >&2
    echo "       Если спецификации действительно нет (инцидент, хотфикс) — передайте --no-spec." >&2
    usage
  fi

  if [[ -n "$SPEC_PR" ]] && ! [[ "$SPEC_PR" =~ ^[!#]?[0-9]+$ ]]; then
    echo "error: '$SPEC_PR' не похож на номер PR (ожидается, например, 456)" >&2; usage
  fi

  if (( PLAN )); then
    COMMAND="/plan $TICKET ${SPEC_PR:-}"
  elif (( NO_SPEC )); then
    COMMAND="/ticket $TICKET --no-spec"
  else
    COMMAND="/ticket $TICKET $SPEC_PR"
  fi
fi

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a; source "$PROJECT_ROOT/.env"; set +a
fi

WORKSPACE_PATH="${WORKSPACE_PATH:-$PROJECT_ROOT}"
export WORKSPACE_PATH

if [[ ! -d "$WORKSPACE_PATH" ]]; then
  echo "error: WORKSPACE_PATH='$WORKSPACE_PATH' не существует — укажите чекаут сервиса" >&2
  exit 1
fi

echo "[run-agent] workspace: $WORKSPACE_PATH" >&2
echo "[run-agent] spec repo: ${SPEC_PROJECT_ID:-(не настроен)} @ ${SPEC_BASE_URL:-${VCS_BASE_URL:-?}}" >&2
echo "[run-agent] command:   $COMMAND" >&2

GIGACODE_BIN="${GIGACODE_BIN:-gigacode}"
if ! command -v "$GIGACODE_BIN" >/dev/null 2>&1; then
  echo "error: '$GIGACODE_BIN' не найден в PATH. Задайте GIGACODE_BIN." >&2
  exit 127
fi

cd "$PROJECT_ROOT"
exec "$GIGACODE_BIN" --agent backend-developer "$COMMAND"
