# Как это работает

## Поток выполнения тикета

```
./scripts/run-agent.sh BACK-1234
        │
        ▼
GigaCode CLI читает .gigacode/settings.json
        │  запускает scripts/start-tools-server.sh (stdio)
        ▼
tools-server: загружает src/tools/* + dynamic/*.tool.ts → tools/list
        │
        ▼
Агент (роль из .gigacode/agents/backend-developer.md):

  1. docs_read()                      карта базы
  2. docs_read("…/ticket-lifecycle")  процесс
  3. jira_get_issue("BACK-1234")      что делать
  4. docs_read("40-projects/…")       в каком сервисе
  5. docs_search(термины тикета)      по каким правилам
        │
        ▼
  План пользователю (файлы, конвенции с id, допущения)
        │
        ▼
  git switch -c → правки в WORKSPACE_PATH → тесты
        │
        ▼
  ./mvnw clean verify ──► красная? чинить, не отключать
        │ зелёная
        ▼
  самопроверка по proc-review-checklist
        │
        ▼
  commit → push → create_merge_request (draft)
```

## Почему инструментов мало

Каждый инструмент — это постоянный расход контекста (описание в `tools/list`)
и ещё одна вещь, которую нужно сопровождать. Набор из шести покрывает то, что
нельзя сделать иначе: доступ к базе знаний, доступ к тикету и возможность
расширить себя. Файлы, git и сборка уже есть во встроенном shell.

Когда агенту нужна седьмая операция, он решает: сделать разово через shell или
оформить инструментом. Критерии — в
`ai-docs/50-runbooks/agent-self-extension.md`.

## Как работает самописный инструмент

```
tool_create(name, source)
   │
   ├─ записать dynamic/<name>.tool.ts   (предыдущая версия в .bak)
   ├─ esbuild: ts → esm → .cache/<name>.<hash>.mjs
   ├─ import() и проверка структуры
   │     └─ не скомпилировалось → откат файла, инструмент не появляется
   ├─ registry.register(..., "dynamic")
   └─ notifications/tools/list_changed → клиент перечитывает tools/list
```

Хеш содержимого в имени файла кэша — то, что позволяет перезагружать модуль без
рестарта процесса: ESM-кэш Node ключуется по URL, и у новой версии URL другой.

Инструмент остаётся файлом в репозитории, попадает в MR и проходит ревью.
Прижившиеся переносятся в `tools-server/src/tools/` как встроенные.

## Границы доверия

| Что | Кто решает |
|---|---|
| какие команды shell разрешены | `permissions` в `settings.json` |
| что агент может прочитать | `permissions.deny` + отсутствие доступа к `.env` |
| может ли агент писать инструменты | `TOOLS_ALLOW_DYNAMIC` |
| снятие draft с MR, ревьюеры, статус тикета | человек |
| правки в `ai-docs` | человек (агент только предлагает в описании MR) |

`ai-docs` закрыт на запись намеренно: агент, который сам себе переписывает
правила, перестаёт быть проверяемым.

## Почему секреты не в settings.json

`settings.json` версионируется. Сервер запускается через
`scripts/start-tools-server.sh`, который читает `.env` (в `.gitignore`) и
передаёт переменные процессу. В `settings.json` остаются только пути.
