import type { z } from "zod";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

export interface ToolContext {
  config: Config;
  logger: Logger;
  /** Перечитать каталог инструментов и отправить клиенту tools/list_changed. */
  reloadDynamicTools(): Promise<{ loaded: string[]; failed: { file: string; error: string }[] }>;
  /** Имена инструментов, доступных модели сейчас. */
  listToolNames(): string[];
}

export interface ToolResultContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  /** Тип результата в MCP открытый; это сохраняет совместимость с SDK. */
  [key: string]: unknown;
  content: ToolResultContent[];
  isError?: boolean;
  /** Необязательная машиночитаемая часть; клиент, который её не понимает, получит `content`. */
  structuredContent?: Record<string, unknown>;
}

/** Объект JSON Schema — для инструментов, написанных без zod. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition<I = unknown> {
  name: string;
  title?: string;
  description: string;
  /** Схема zod (предпочтительно) либо готовый объект JSON Schema. */
  inputSchema: z.ZodType<I> | JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Проставляется загрузчиком для инструментов из каталога dynamic. */
  source?: "builtin" | "dynamic";
  sourceFile?: string;
  handler(input: I, ctx: ToolContext): Promise<ToolResult | string>;
}

/** Тождественный хелпер: даёт полный вывод типов в файлах инструментов. */
export function defineTool<I>(def: ToolDefinition<I>): ToolDefinition<I> {
  return def;
}

export function text(body: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: body }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function failure(body: string): ToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}
