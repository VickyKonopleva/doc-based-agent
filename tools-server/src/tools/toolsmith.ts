import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";
import { importToolFile, TOOL_FILE_RE } from "../runtime/dynamic.js";

const NAME_RE = /^[a-z][a-z0-9_]{2,47}$/;

const TEMPLATE = `import { defineTool, z } from "./_sdk.js";

export default defineTool({
  name: "my_tool",
  description: "Что делает инструмент и когда к нему обращаться.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({
    example: z.string().describe("Опиши каждое поле — модель видит только эти описания."),
  }),
  async handler(input, ctx) {
    // ctx.config  — пути и доступы: ai-docs, services, spec, jira
    // ctx.logger  — лог в stderr или файл; в stdout писать нельзя
    return { content: [{ type: "text", text: \`получено \${input.example}\` }] };
  },
});
`;

export const toolCreate: ToolDefinition<{ name: string; source: string; overwrite?: boolean }> = defineTool({
  name: "tool_create",
  title: "Создать инструмент",
  description:
    "Добавить новый инструмент в работающий сервер и получить его сразу, без рестарта. " +
    "Пиши инструмент, когда собираешься повторить нетривиальную механическую операцию: вызов внутреннего API, " +
    "разбор отчёта сборки, выгрузку схемы. Исходник — модуль TypeScript с default-экспортом " +
    "defineTool({ name, description, inputSchema, handler }); inputSchema — объект zod. " +
    "Точный вид выдаёт tool_template. Файл остаётся в tools-server/dynamic/ и проходит ревью наравне с кодом.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: z.object({
    name: z.string().describe("Имя в snake_case, 3–48 символов. Должно совпадать с полем `name` внутри исходника."),
    source: z.string().min(40).describe("Полный исходный текст модуля на TypeScript."),
    overwrite: z.boolean().optional().describe("Заменить существующий инструмент с тем же именем (по умолчанию false)."),
  }),
  async handler(input, ctx) {
    const cfg = ctx.config;
    if (!cfg.allowDynamicTools) return failure("Создание инструментов отключено (TOOLS_ALLOW_DYNAMIC=false).");
    if (!NAME_RE.test(input.name)) {
      return failure(`Недопустимое имя "${input.name}". Нужен snake_case, 3–48 символов, начиная с буквы.`);
    }
    if (ctx.listToolNames().includes(input.name) && !input.overwrite) {
      return failure(`Инструмент "${input.name}" уже есть. Передай overwrite: true, чтобы заменить.`);
    }

    const file = path.join(cfg.dynamicDir, `${input.name}.tool.ts`);
    const backup = `${file}.bak`;
    let hadPrevious = false;
    try {
      await fs.copyFile(file, backup);
      hadPrevious = true;
    } catch { /* прежней версии не было */ }

    await fs.writeFile(file, input.source.endsWith("\n") ? input.source : input.source + "\n", "utf8");

    // Компилируем и импортируем до регистрации: сломанный инструмент не должен дойти до модели.
    try {
      const tools = await importToolFile(file, cfg);
      const names = tools.map((t) => t.name);
      if (!names.includes(input.name)) {
        throw new Error(`модуль экспортирует ${names.join(", ") || "ничего"}, а запрошено имя "${input.name}"`);
      }
    } catch (err) {
      if (hadPrevious) await fs.copyFile(backup, file).catch(() => {});
      else await fs.rm(file, { force: true });
      await fs.rm(backup, { force: true });
      return failure(`Инструмент "${input.name}" отклонён, на диске ничего не изменилось:\n${err instanceof Error ? err.message : String(err)}`);
    }
    await fs.rm(backup, { force: true });

    const report = await ctx.reloadDynamicTools();
    ctx.logger.info("tool created", { name: input.name, file });

    return text(
      `Инструмент "${input.name}" готов (${path.relative(cfg.dynamicDir, file)}), можно вызывать прямо сейчас.\n` +
        `Сейчас доступны: ${ctx.listToolNames().join(", ")}` +
        (report.failed.length ? `\nНе загружаются другие файлы: ${report.failed.map((f) => f.file).join(", ")}` : ""),
      { created: input.name, file },
    );
  },
});

export const toolList: ToolDefinition<Record<string, never>> = defineTool({
  name: "tool_list",
  title: "Список инструментов",
  description: "Показать все инструменты сервера, отметив встроенные и написанные агентом.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const report = await ctx.reloadDynamicTools();
    let files: string[] = [];
    try {
      files = (await fs.readdir(ctx.config.dynamicDir)).filter((f) => TOOL_FILE_RE.test(f));
    } catch { /* каталога может ещё не быть */ }

    return text(
      `Доступные инструменты: ${ctx.listToolNames().join(", ")}\n` +
        `Написаны агентом, в ${ctx.config.dynamicDir}: ${files.join(", ") || "(нет)"}\n` +
        (report.failed.length
          ? `Не загружаются:\n${report.failed.map((f) => `  ${f.file}: ${f.error}`).join("\n")}`
          : "Все файлы инструментов загружаются без ошибок."),
      { tools: ctx.listToolNames(), files, failed: report.failed },
    );
  },
});

export const toolTemplate: ToolDefinition<Record<string, never>> = defineTool({
  name: "tool_template",
  title: "Шаблон инструмента",
  description: "Выдать скелет модуля инструмента и критерии, когда его стоит писать. Прочитай перед первым tool_create.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    return text(
      [
        "Напиши модуль ровно в таком виде и передай его как `source` в tool_create:",
        "",
        "```ts",
        TEMPLATE.trim(),
        "```",
        "",
        "Когда создавать инструмент (нужно минимум два пункта из трёх):",
        "- операция повторится в следующих задачах;",
        "- она механическая, с чётким входом и выходом;",
        "- вручную это больше трёх шагов или разбор сырого ответа API.",
        "",
        "Сначала убедись, что возможности нет иначе:",
        "- её уже даёт подключённый MCP-сервер — пользуйся им;",
        "- она делается парой команд в оболочке — делай командами.",
        "Инструмент это интерфейс к возможности, а не обёртка над командой.",
        "",
        "Когда НЕ создавать:",
        "- одноразовое действие в рамках одной задачи — проще bash;",
        "- операция требует суждения (выбор архитектуры, текст описания MR);",
        "- такой инструмент уже есть — проверь tool_list;",
        "- понадобился бы захардкоженный секрет.",
        "",
        "Правила:",
        "- Файл ляжет в " + ctx.config.dynamicDir + " как <name>.tool.ts, рядом с _sdk.ts — импортируй defineTool/z/text/failure из \"./_sdk.js\".",
        "- Node 20+, ESM, TypeScript. Доступны fetch, node:fs/promises, node:child_process и zod.",
        "- Никогда не пиши в stdout (там протокол MCP). Логируй через ctx.logger.",
        "- Возвращай строку либо { content: [{ type: 'text', text }], isError?, structuredContent? }.",
        "- Секреты берутся из ctx.config (сервер читает окружение); токен в исходнике недопустим.",
        "- Один инструмент на файл; у каждого поля zod — .describe(), это всё, что видит модель.",
        "- Разрушающее действие помечай annotations.destructiveHint: true.",
        "",
        "Инструмент — это код: файл попадёт в MR и пройдёт ревью наравне с остальным.",
      ].join("\n"),
    );
  },
});

export const toolDelete: ToolDefinition<{ name: string }> = defineTool({
  name: "tool_delete",
  title: "Удалить инструмент",
  description: "Удалить инструмент, написанный агентом. Встроенные удалить нельзя.",
  annotations: { readOnlyHint: false, destructiveHint: true },
  inputSchema: z.object({ name: z.string().describe("Имя удаляемого инструмента, написанного агентом.") }),
  async handler(input, ctx) {
    const file = path.join(ctx.config.dynamicDir, `${input.name}.tool.ts`);
    try {
      await fs.rm(file);
    } catch {
      return failure(`В ${ctx.config.dynamicDir} нет файла инструмента "${input.name}".`);
    }
    await ctx.reloadDynamicTools();
    return text(`Удалён "${input.name}". Остались: ${ctx.listToolNames().join(", ")}`);
  },
});

export const toolsmithTools = [toolTemplate, toolCreate, toolList, toolDelete];
