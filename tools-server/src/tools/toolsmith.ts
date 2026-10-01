import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";
import { importToolFile, TOOL_FILE_RE } from "../runtime/dynamic.js";

const NAME_RE = /^[a-z][a-z0-9_]{2,47}$/;

const TEMPLATE = `import { defineTool, z } from "./_sdk.js";

export default defineTool({
  name: "my_tool",
  description: "What this tool does and when the agent should reach for it.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({
    example: z.string().describe("Describe every field — the model only sees these descriptions."),
  }),
  async handler(input, ctx) {
    // ctx.config  — paths and credentials (ai-docs, workspace, vcs, jira)
    // ctx.logger  — stderr/file logging; never write to stdout
    return { content: [{ type: "text", text: \`got \${input.example}\` }] };
  },
});
`;

export const toolCreate: ToolDefinition<{ name: string; source: string; overwrite?: boolean }> = defineTool({
  name: "tool_create",
  title: "Create a tool",
  description:
    "Write a new tool into the running tool server and expose it immediately — no restart. " +
    "Use this whenever you find yourself about to repeat a non-trivial mechanical operation (calling an internal API, " +
    "parsing a build report, opening a merge request). The source is a TypeScript module that default-exports " +
    "defineTool({ name, description, inputSchema, handler }); inputSchema is a zod object. " +
    "Call tool_template first if you need the exact shape. Tools persist in tools-server/dynamic/ and are reviewed like any other code.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: z.object({
    name: z.string().describe("snake_case tool name, 3-48 chars. Must match the `name` inside the source."),
    source: z.string().min(40).describe("Full TypeScript source of the module."),
    overwrite: z.boolean().optional().describe("Replace an existing tool file with the same name (default false)."),
  }),
  async handler(input, ctx) {
    const cfg = ctx.config;
    if (!cfg.allowDynamicTools) return failure("Tool authoring is disabled (TOOLS_ALLOW_DYNAMIC=false).");
    if (!NAME_RE.test(input.name)) {
      return failure(`Invalid tool name "${input.name}". Use snake_case, 3-48 chars, starting with a letter.`);
    }
    if (ctx.listToolNames().includes(input.name) && !input.overwrite) {
      return failure(`Tool "${input.name}" already exists. Pass overwrite: true to replace it.`);
    }

    const file = path.join(cfg.dynamicDir, `${input.name}.tool.ts`);
    const backup = `${file}.bak`;
    let hadPrevious = false;
    try {
      await fs.copyFile(file, backup);
      hadPrevious = true;
    } catch { /* no previous version */ }

    await fs.writeFile(file, input.source.endsWith("\n") ? input.source : input.source + "\n", "utf8");

    // Compile and import before announcing it: a broken tool must not reach the model.
    try {
      const tools = await importToolFile(file, cfg);
      const names = tools.map((t) => t.name);
      if (!names.includes(input.name)) {
        throw new Error(`module exports ${names.join(", ") || "nothing"}, but the requested name was "${input.name}"`);
      }
    } catch (err) {
      if (hadPrevious) await fs.copyFile(backup, file).catch(() => {});
      else await fs.rm(file, { force: true });
      await fs.rm(backup, { force: true });
      return failure(`Tool "${input.name}" was rejected and nothing was changed:\n${err instanceof Error ? err.message : String(err)}`);
    }
    await fs.rm(backup, { force: true });

    const report = await ctx.reloadDynamicTools();
    ctx.logger.info("tool created", { name: input.name, file });

    return text(
      `Tool "${input.name}" is live (${path.relative(cfg.dynamicDir, file)}). You can call it right now.\n` +
        `Tools currently available: ${ctx.listToolNames().join(", ")}` +
        (report.failed.length ? `\nOther dynamic files failing to load: ${report.failed.map((f) => f.file).join(", ")}` : ""),
      { created: input.name, file },
    );
  },
});

export const toolList: ToolDefinition<Record<string, never>> = defineTool({
  name: "tool_list",
  title: "List tools",
  description: "List every tool this server currently exposes, marking which are built in and which were authored by the agent.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const report = await ctx.reloadDynamicTools();
    let files: string[] = [];
    try {
      files = (await fs.readdir(ctx.config.dynamicDir)).filter((f) => TOOL_FILE_RE.test(f));
    } catch { /* directory may not exist yet */ }

    return text(
      `Available tools: ${ctx.listToolNames().join(", ")}\n` +
        `Agent-authored files in ${ctx.config.dynamicDir}: ${files.join(", ") || "(none)"}\n` +
        (report.failed.length
          ? `Failing to load:\n${report.failed.map((f) => `  ${f.file}: ${f.error}`).join("\n")}`
          : "All dynamic tool files load cleanly."),
      { tools: ctx.listToolNames(), files, failed: report.failed },
    );
  },
});

export const toolTemplate: ToolDefinition<Record<string, never>> = defineTool({
  name: "tool_template",
  title: "Tool template",
  description: "Return the skeleton of a tool module, plus the context object a handler receives. Read this before your first tool_create.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    return text(
      [
        "Write the module exactly like this and pass it as `source` to tool_create:",
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
  title: "Delete a tool",
  description: "Remove an agent-authored tool. Built-in tools cannot be deleted.",
  annotations: { readOnlyHint: false, destructiveHint: true },
  inputSchema: z.object({ name: z.string().describe("Name of the agent-authored tool to remove.") }),
  async handler(input, ctx) {
    const file = path.join(ctx.config.dynamicDir, `${input.name}.tool.ts`);
    try {
      await fs.rm(file);
    } catch {
      return failure(`No agent-authored tool file for "${input.name}" in ${ctx.config.dynamicDir}.`);
    }
    await ctx.reloadDynamicTools();
    return text(`Removed "${input.name}". Remaining tools: ${ctx.listToolNames().join(", ")}`);
  },
});

export const toolsmithTools = [toolTemplate, toolCreate, toolList, toolDelete];
