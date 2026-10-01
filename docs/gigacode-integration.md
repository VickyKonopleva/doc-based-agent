# Интеграция с GigaCode CLI

Конфигурация сверена с официальной документацией GigaCode CLI на gitverse.ru:
[MCP](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/mcp),
[субагенты](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/subagents),
[skills](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/skills),
[команды](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/commands),
[memory](https://gitverse.ru/docs/ai/ai-assistant-gigacode/gigacode-cli/memory).

## Что используется и где это описано

| Механизм | Путь | Формат |
|---|---|---|
| проектные инструкции | `GIGACODE.md` в корне | обычный Markdown, читается каждой сессией |
| локальные адреса | `.gigacode/GIGACODE.local.md` | то же, но не версионируется; сюда Nexus и прочее местное |
| MCP-серверы | `.gigacode/settings.json` → `mcpServers` | `command`/`args`/`cwd` для stdio, `httpUrl`/`headers` для http |
| разрешённые серверы | `settings.json` → `mcp.allowed` | список имён |
| субагенты | `.gigacode/agents/*.md` | frontmatter `name`, `description`, `model`, `approvalMode`, `tools`, `disallowedTools` |
| скилы | `.gigacode/skills/<name>/SKILL.md` | frontmatter `name`, `description`, `priority`, `paths`; каталог пуст — наполняет сам агент |
| команды | `.gigacode/commands/*.md` | frontmatter `description`, подстановка `{{args}}` |

## MCP

```json
"be-tools": {
  "command": "npx",
  "args": ["tsx", "src/index.ts"],
  "cwd": "tools-server",
  "timeout": 60000,
  "discoveryTimeoutMs": 60000,
  "trust": false
}
```

- `cwd: "tools-server"` — там лежат `package.json` и `node_modules`, поэтому
  `npx` берёт локальный `tsx`, а не тянет его из сети. Сборка перед запуском
  не нужна.
- `discoveryTimeoutMs` поднят до 60 с: дефолт для stdio — 30 с, а первый
  холодный старт `npx tsx` может в него не уложиться. `timeout` относится к
  `tools/call` и к discovery отношения не имеет.
- Блока `env` нет: сервер читает `.env` из корня проекта сам. Переменные,
  уже заданные в окружении, имеют приоритет, поэтому в CI ничего менять не
  надо.

**`includeTools` для `be-tools` намеренно не задан.** Этот allowlist отсекал
бы инструменты, которые агент создаёт через `tool_create` в середине задачи.
Для внешнего Jira MCP, наоборот, выставлен `excludeTools` на всё, что меняет
тикеты, — агент их только читает.

## Субагенты

Четыре read-only субагента с `approvalMode: plan` и явным `tools`.

Важный нюанс из документации: **если `approvalMode` задан явно, более
permissive режим родителя всё равно имеет приоритет.** Значит `plan` сам по
себе не гарантирует read-only — настоящая гарантия это `tools` без
`write_file`, `edit` и (где не нужен) `run_shell_command`.

У оркестратора `tools` не задан сознательно: без allowlist он наследует весь
пул, включая инструменты, созданные на лету.

Делегирование в GigaCode автоматическое — по полю `description`, поэтому в
описаниях стоят рекомендованные документацией формулировки `MUST BE USED` и
`USE PROACTIVELY`. Дополнительно оркестратор вызывает субагентов по имени в
конкретных фазах: для процесса с жёстким порядком это надёжнее.

Режим `fork` не используется. Он наследует контекст и работает в фоне, но
**не возвращает результат в основной диалог автоматически** — для разведки,
результат которой нужен оркестратору, это не подходит.

## Проверить на первом запуске

Два места, где возможны расхождения с вашей сборкой CLI:

1. **Имена встроенных инструментов** в `tools` субагентов. Взяты из примеров
   документации: `read_file`, `write_file`, `edit`, `read_many_files`,
   `grep_search`, `glob`, `list_directory`, `run_shell_command`. Сверьте
   командой `/tools` и поправьте, если отличаются.
2. **Формат имени MCP-инструмента в allowlist** — `mcp__be-tools__docs_read`.
   Документация приводит такой шаблон для `disallowedTools`; для `tools`
   формат явно не описан. Если `docs-researcher` сообщит, что инструментов
   нет, замените у него `tools` на `disallowedTools` со списком пишущих
   инструментов — тогда он унаследует все MCP-инструменты родителя.

```
/mcp            какие серверы подключились и какие инструменты дали
/tools          полный список инструментов сессии
/agents manage  список субагентов
/skills         список скилов
/memory         какие файлы инструкций загружены
```

## Проверка в изоляции

```bash
cd tools-server && npm run check     # конфигурация .gigacode
cd tools-server && npm run smoke     # 51 проверок сервера на фикстурах, без сети
cd tools-server && npm run inspect   # веб-инспектор MCP, вызов инструментов руками
```

Сервер — стандартный MCP over stdio. Если инспектор видит инструменты, а
GigaCode нет — дело в записи в `settings.json`, а не в сервере.

## Ограничение доступа

Три независимых механизма:

| Уровень | Поле | Где |
|---|---|---|
| какие серверы доступны | `mcp.allowed`, `mcp.excluded` | `settings.json` |
| какие инструменты сервера видны | `includeTools`, `excludeTools` | запись сервера |
| что доступно агенту | `tools`, `disallowedTools` | frontmatter агента |

Отдельного блока `permissions` с шаблонами команд в схеме GigaCode нет.
Поэтому жёсткие запреты — force-push, коммит секретов, пуш в защищённые
ветки — выносите в хуки: `.gigacode/hooks/README.md`.

## Чеклист первого запуска

- [ ] `./scripts/bootstrap.sh` отработал
- [ ] `cd tools-server && npm run check` — конфигурация в порядке
- [ ] `cd tools-server && npm run smoke` — все проверки зелёные
- [ ] `.env` заполнен и не попал в git (`git check-ignore -v .env`)
- [ ] база знаний доступна: `bootstrap.sh` печатает число документов
- [ ] `/memory` показывает `GIGACODE.md` и `GIGACODE.local.md`
- [ ] `/mcp` показывает `bitbucket`, `jira` и `be-tools`
- [ ] в `/tools` есть `docs_search` и инструменты MCP Bitbucket
- [ ] `/agents manage` показывает пять агентов
- [ ] `/skills` пуст — скилы создаёт сам агент, предустановленных нет
- [ ] `/ticket BACK-1234 456` начинается с `spec_get_pr`

## Запуск сервера руками

Обычно его запускает GigaCode сам по `settings.json`. Отдельно он нужен для
отладки — и это всегда stdio-процесс: запущенный в терминале, он молча ждёт
JSON-RPC на входе, это нормальное поведение, а не зависание.

```bash
cd tools-server && npm install     # один раз
```

```bash
cd tools-server && npm run inspect
```

Веб-инспектор MCP: видно `tools/list`, можно вызвать любой инструмент руками
и посмотреть ответ. Основной способ отладки.

```bash
cd tools-server && npm run dev
```

`tsx watch` — перезапуск при правке `src/`. Логи идут в stderr. Полезно,
когда инспектор уже подключён к серверу, запущенному таким образом.

```bash
cd tools-server && npm run smoke
```

Прогон на фикстурах: ответ на вопрос «сервер вообще рабочий», без Jira,
Bitbucket и базы знаний.

Одноразовая проверка, что процесс поднимается и отвечает:

```bash
cd tools-server && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' | npx tsx src/index.ts
```

В stdout придёт `initialize`-ответ, в stderr — строка `ai-tools-server ready`
со списком инструментов и путями, которые сервер считал из `.env`. Это самый
быстрый способ увидеть, туда ли смотрит `AI_DOCS_PATH`.

Сборка для запуска не нужна: `npx tsx` исполняет TypeScript напрямую. Вариант
`node dist/index.js` работает после `npm run build`.

### Если что-то не так

| Симптом | Причина |
|---|---|
| в stdout мусор вместо JSON | что-то пишет в stdout; там только протокол, логи — в stderr |
| `/mcp` показывает Disconnected | смотрите stderr процесса; поднимите `discoveryTimeoutMs` |
| `docs_read` отвечает «база знаний недоступна» | `AI_DOCS_PATH` в `.env`; сервер печатает его при старте |
| агент не находит репозиторий сервиса | префикс и суффикс в `.gigacode/GIGACODE.local.md` |
| клон по ssh просит пароль | ключ не добавлен в ssh-agent |
| `spec_get_pr` не виден в `/tools` | это нормально при `SPEC_PROVIDER=external`: PR аналитики читает MCP Bitbucket |
| инструмент, созданный агентом, не виден | `tool_list` перечитывает каталог; битый файл перечислен там же с ошибкой |
| скил не появился | скилы не подхватываются на лету, нужна новая сессия |

Подробные логи: `LOG_LEVEL=debug` и, при необходимости, `LOG_FILE=/tmp/be-tools.log`
в `.env` — иначе stderr уходит в CLI.
