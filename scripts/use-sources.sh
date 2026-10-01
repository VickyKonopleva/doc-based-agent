#!/usr/bin/env bash
# Переключить источники Jira и Bitbucket между внешними MCP-серверами и
# встроенными инструментами be-tools.
#
#   ./scripts/use-sources.sh external   # Jira и Bitbucket приходят по MCP
#   ./scripts/use-sources.sh builtin    # be-tools сам ходит в Jira и Bitbucket
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-external}"
SETTINGS="$PROJECT_ROOT/.gigacode/settings.json"

case "$MODE" in
  external)
    cp "$PROJECT_ROOT/.gigacode/settings.external.json" "$SETTINGS"
    cat <<'MSG'
settings.json: Jira и Bitbucket подключены как внешние MCP-серверы.

В .env выставьте:
    JIRA_PROVIDER=external
    SPEC_PROVIDER=external
    SERVICES_PROVIDER=external

Тогда be-tools не регистрирует jira_get_issue, spec_get_pr, spec_read_file и
service_list — агент пользуется инструментами внешних серверов.

service_checkout продолжает работать: он ходит обычным git, API ему не нужен.
MSG
    ;;
  builtin)
    cp "$PROJECT_ROOT/.gigacode/settings.builtin.json" "$SETTINGS"
    cat <<'MSG'
settings.json: внешние MCP-серверы отключены, всё делает be-tools.

В .env выставьте:
    JIRA_PROVIDER=local      + JIRA_BASE_URL, JIRA_TOKEN
    SPEC_PROVIDER=bitbucket  + SPEC_BASE_URL, SPEC_PROJECT_ID, SPEC_TOKEN
    SERVICES_PROVIDER=bitbucket
MSG
    ;;
  *)
    echo "usage: $0 [external|builtin]" >&2
    exit 2
    ;;
esac
