---
id: run-agent-self-extension
title: Как агент создаёт себе инструменты
type: runbook
scope: [agent]
tags: [tools, mcp, self-extension, toolsmith, automation]
status: active
owner: platform-team
updated: 2026-10-01
---

# Как агент создаёт себе инструменты

Агент стартует с минимальным набором: чтение базы знаний, чтение тикета и
«кузница» инструментов. Всё остальное он делает руками через shell — до тех пор,
пока операция не начнёт повторяться.

## Когда создавать инструмент

Создавай, если выполняется хотя бы два условия:

- операция повторится в следующих тикетах;
- она механическая и имеет чёткий вход/выход;
- выполнение её вручную требует больше трёх шагов или разбора сырого ответа API.

Примеры уместного: открыть MR, получить отчёт о покрытии, дёрнуть внутренний
реестр сервисов, распарсить surefire-отчёт.

## Когда НЕ создавать

- Одноразовое действие в рамках одного тикета — проще `bash`.
- Операция требует суждения (выбор архитектуры, формулировка описания MR).
- Уже есть встроенный инструмент или готовый инструмент в `tool_list`.
- Инструмент потребовал бы захардкоженного секрета.

## Порядок

1. `tool_list` — убедиться, что такого ещё нет.
2. `tool_template` — получить актуальный скелет модуля.
3. `tool_create` — передать `name` и полный исходник.
   Сервер компилирует и загружает модуль; если он не компилируется, изменения
   откатываются и инструмент не появляется.
4. Вызвать инструмент. Если поведение не то — `tool_create` с `overwrite: true`.

## Требования к инструменту

- Одна ответственность, `snake_case`-имя.
- У каждого поля `inputSchema` — `.describe()`: это единственное, что видит модель.
- Секреты только из `ctx.config` (сервер читает окружение), никогда в коде.
- Ничего не писать в stdout — там протокол MCP; логировать через `ctx.logger`.
- Разрушающее действие помечается `annotations.destructiveHint: true`.

## Инструмент — это код

Файл появляется в `tools-server/dynamic/<name>.tool.ts` и попадает в тот же MR,
что и изменения сервиса. Он проходит обычное ревью. Прижившиеся инструменты
переносятся в `tools-server/src/tools/` как встроенные.

## Пример

```ts
import { defineTool, failure, text, z } from "./_sdk.js";

export default defineTool({
  name: "jacoco_summary",
  description: "Прочитать target/site/jacoco/jacoco.csv и вернуть покрытие по пакетам.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({
    module: z.string().optional().describe("Подкаталог модуля, если проект многомодульный."),
  }),
  async handler(input, ctx) {
    const { readFile } = await import("node:fs/promises");
    const path = `${ctx.config.workspacePath}/${input.module ?? "."}/target/site/jacoco/jacoco.csv`;
    try {
      return text(await readFile(path, "utf8"));
    } catch {
      return failure(`Нет отчёта: ${path}. Сначала запусти ./mvnw verify.`);
    }
  },
});
```
