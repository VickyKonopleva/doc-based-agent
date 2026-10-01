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
| `skills/` | пусто: процедуры сюда пишет сам агент через `skill_create` |
| `commands/` | `/ticket`, `/plan`, `/spec`, `/docs-gap` |
| `ai-docs-pointers.md` | «тема → документ» вашей базы знаний, заполняется командой |
| `hooks/` | пусто; сюда то, что должно соблюдаться всегда |
| `settings*.json` | MCP-серверы и список разрешённых |

## Четыре уровня, не пересекающиеся по смыслу

| Уровень | Отвечает на вопрос | Кто сопровождает |
|---|---|---|
| база знаний `ai-docs` | **что** принято в компании | команда, вне репозитория |
| `skills/` | **как** выполнить процедуру | сам агент |
| `tools-server/dynamic/` | детерминированные операции | сам агент |
| `agents/` | кто что видит и в каком контексте | владелец агента |

Правило компании живёт только в базе знаний. Предустановленных скилов нет:
скил, повторяющий документ базы, создаёт вторую копию правила, и копии
разойдутся. Агент пишет скил сам — и только тогда, когда поймал процедуру,
которой в базе нет, либо когда нужен `paths:`-гейт, которого база не умеет.

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

| Файл | Jira и Bitbucket | Когда применять |
|---|---|---|
| `settings.external.json` | внешние MCP-серверы по `httpUrl` | по умолчанию: Bitbucket и Jira уже доступны как MCP |
| `settings.builtin.json` | `be-tools` ходит в них сам по REST | нет MCP-серверов, или нужен полный контроль над выдачей |

```bash
./scripts/use-sources.sh external    # или builtin
```

Скрипт копирует выбранный профиль в `settings.json` и печатает, какие
значения выставить в `.env`. В режиме `external` наш сервер не регистрирует
`jira_get_issue`, `spec_get_pr`, `spec_read_file` и `service_list` — конфликта
имён с внешними серверами не возникает.

`service_checkout` работает в обоих режимах: он ходит обычным `git`, API ему
не нужен.

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
