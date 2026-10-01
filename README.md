# doc-based-agent

Рабочее место AI-агента **`backend-developer`** на GigaCode CLI.

Агент получает на вход **только номер тикета Jira** и доводит задачу до draft
merge request. Он не знает конвенций компании наизусть — всё, что он знает,
лежит в `ai-docs/`. Инструментов у него минимум, недостающие он пишет себе сам.

```
┌───────────────┐   номер тикета    ┌──────────────────────┐
│  разработчик  │ ────────────────► │   GigaCode CLI       │
└───────────────┘                   │   .gigacode/         │
                                    └──────────┬───────────┘
                                   MCP (stdio) │
                                    ┌──────────▼───────────┐
                                    │   tools-server (TS)  │
                                    │  docs_* jira_* tool_*│
                                    └──┬────────┬──────────┘
                                       │        │
                              ┌────────▼──┐  ┌──▼────────────────┐
                              │  ai-docs  │  │ dynamic/ — тулы,  │
                              │ (правила) │  │ написанные агентом│
                              └───────────┘  └───────────────────┘
```

## Идея

| Обычный агент | Этот агент |
|---|---|
| десятки скилов и тулов в конфиге | 6 встроенных инструментов |
| правила зашиты в промпт | правила в версионируемой базе `ai-docs` |
| новый кейс → правка промпта | новый кейс → документ в `ai-docs` |
| не хватает инструмента → правка кода и рестарт | агент пишет инструмент сам, на лету |

Меняется процесс — меняется документ, а не конфигурация агента.

## Структура

```
.gigacode/              настройки GigaCode CLI
  settings.json           MCP-сервер + permissions (активный профиль)
  settings.local-jira.json  профиль: Jira из нашего ts-сервера
  settings.jira-mcp.json    профиль: Jira из внешнего MCP-коннектора
  AGENTS.md               проектные инструкции, загружаются всегда
  agents/
    backend-developer.md  роль и процедура агента
  commands/               /ticket, /plan, /docs-gap
  skills/                 намеренно пусто
  hooks/                  пусто; сюда — то, что должно работать всегда
ai-docs/                база знаний — единственный источник правды
tools-server/           ts-сервер инструментов (MCP over stdio)
  src/tools/              встроенные инструменты
  dynamic/                инструменты, написанные агентом
  fixtures/jira/          фикстуры для режима JIRA_PROVIDER=mock
scripts/                bootstrap, запуск сервера и агента
docs/                   как это устроено и как адаптировать
```

## Быстрый старт

```bash
./scripts/bootstrap.sh
```

Заполнить `.env` (как минимум `WORKSPACE_PATH`, `JIRA_BASE_URL`, `JIRA_TOKEN`),
затем:

```bash
./scripts/run-agent.sh BACK-1234
```

Только разбор и план, без правок:

```bash
./scripts/run-agent.sh BACK-1234 --plan
```

Из IntelliJ IDEA: конфигурации запуска **Bootstrap**, **Agent: ticket**,
**Agent: plan only**, **Tools server (dev)**, **MCP Inspector** уже лежат в
`.idea/runConfigurations`.

## Проверка без Jira и без GigaCode

```bash
cd tools-server && JIRA_PROVIDER=mock npm run smoke
```

Поднимает сервер по stdio ровно так же, как это делает GigaCode, и проверяет
23 сценария: список инструментов, чтение и поиск по базе, разбор тикета из
фикстуры и создание агентом нового инструмента на лету.

Посмотреть и подёргать инструменты руками:

```bash
cd tools-server && npm run inspect
```

## Встроенные инструменты

| Инструмент | Назначение |
|---|---|
| `docs_read` | каталог базы или полный текст документа (по пути, `id` или секции) |
| `docs_search` | поиск по тексту, заголовкам, тегам и frontmatter |
| `jira_get_issue` | тикет по номеру: описание, критерии, связи, комментарии |
| `tool_template` | скелет модуля инструмента |
| `tool_create` | написать и подключить новый инструмент без рестарта |
| `tool_list` | что сейчас доступно, что не компилируется |
| `tool_delete` | удалить свой инструмент |

Всё остальное — файлы, git, Maven — через встроенный shell GigaCode,
ограниченный `permissions` в `settings.json`.

## Два источника Jira

Поддерживаются оба, переключаются скриптом:

```bash
./scripts/use-jira-mcp.sh local      # jira_get_issue из нашего ts-сервера
./scripts/use-jira-mcp.sh external   # внешний Jira MCP-коннектор
```

В режиме `external` (`JIRA_PROVIDER=external` в `.env`) наш сервер не
регистрирует `jira_get_issue`, и агент пользуется инструментами внешнего
сервера — конфликта имён не возникает.

## Дальше

- [`docs/how-it-works.md`](docs/how-it-works.md) — поток выполнения тикета.
- [`docs/gigacode-integration.md`](docs/gigacode-integration.md) — что проверить
  под реальный GigaCode CLI и где точки адаптации.
- [`docs/adapting-ai-docs.md`](docs/adapting-ai-docs.md) — как наполнить базу
  под свой контур.
- [`ai-docs/README.md`](ai-docs/README.md) — устройство базы знаний.
