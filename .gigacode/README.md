# .gigacode — конфигурация агента

Всё здесь соответствует документации GigaCode CLI:
[субагенты](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/subagents),
[skills](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/skills),
[команды](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/commands),
[MCP](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/mcp),
[memory](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/memory).

## Что где лежит

| Путь | Что это |
|---|---|
| `../GIGACODE.md` | проектные инструкции, читаются в начале каждой сессии |
| `agents/` | оркестратор и четыре read-only субагента |
| `skills/` | процедуры с шагами и шаблонами |
| `commands/` | `/ticket`, `/plan`, `/spec`, `/docs-gap` |
| `ai-docs-pointers.md` | «тема → документ» вашей базы знаний, заполняется командой |
| `hooks/` | пусто; сюда то, что должно соблюдаться всегда |
| `settings*.json` | MCP-серверы и список разрешённых |

## Четыре уровня, не пересекающиеся по смыслу

| Уровень | Отвечает на вопрос | Кто сопровождает |
|---|---|---|
| база знаний `ai-docs` | **что** принято в компании | команда, вне репозитория |
| `skills/` | **как** выполнить процедуру | владелец агента |
| `tools-server/` | детерминированные операции | владелец агента |
| `agents/` | кто что видит и в каком контексте | владелец агента |

Правило компании живёт только в базе знаний. Скил на него ссылается, но не
дублирует — иначе две копии разойдутся.

## Агенты

| Агент | `approvalMode` | Может менять файлы |
|---|---|---|
| `backend-developer` | `auto-edit` | да — единственный |
| `docs-researcher` | `plan` | нет |
| `code-explorer` | `plan` | нет |
| `build-doctor` | `plan` | нет |
| `self-reviewer` | `plan` | нет |

У субагентов задан `tools` — allowlist. Это и есть настоящая гарантия
read-only: по документации более permissive `approvalMode` родителя имеет
приоритет над `plan` субагента, поэтому полагаться только на режим нельзя.

**У оркестратора `tools` намеренно не задан.** Он наследует весь пул
инструментов — иначе инструмент, который он создаст через `tool_create` в
середине задачи, не попал бы в allowlist и оказался недоступен. По той же
причине у сервера `be-tools` не выставлен `includeTools`.

## Профили settings.json

| Файл | Jira | Когда применять |
|---|---|---|
| `settings.local-jira.json` | `jira_get_issue` из нашего `be-tools` | нет развёрнутого Jira MCP, или нужен полный контроль над выдачей тикета |
| `settings.jira-mcp.json` | внешние Jira и Confluence по `httpUrl` | в контуре уже есть эти MCP-серверы |

```bash
./scripts/use-jira-mcp.sh local      # или external
```

Скрипт копирует выбранный профиль в `settings.json` и напоминает, какое
значение `JIRA_PROVIDER` выставить в `.env`. В режиме `external` наш сервер
не регистрирует `jira_get_issue`, конфликта имён не возникает.

Инструменты PR аналитики (`spec_get_pr`, `spec_read_file`) работают в обоих
профилях.

## Почему секретов нет в settings.json

Файл версионируется. Удалённые серверы получают значения подстановкой, а
локальный `be-tools` читает `.env` сам
(`tools-server/src/lib/config.ts`), поэтому блок `env` ему не нужен.

## Ограничение доступа

В GigaCode это три разных механизма:

| Уровень | Поле | Где |
|---|---|---|
| какие серверы доступны | `mcp.allowed` / `mcp.excluded` | `settings.json` |
| какие инструменты сервера видны | `includeTools` / `excludeTools` | запись сервера |
| что доступно конкретному агенту | `tools` / `disallowedTools` | frontmatter агента |

Жёсткие гарантии вроде «никогда не делать force-push» надёжнее выносить в
хук: инструкция в промпте — мягкая гарантия. См. `hooks/README.md`.
