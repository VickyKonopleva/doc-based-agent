/**
 * Поверхность, против которой пишутся инструменты агента.
 *
 * Файлы инструментов лежат здесь, но исполняются из tools-server/.cache после
 * транспиляции: загрузчик компилирует этот шим в .cache/_sdk.js при каждой
 * перезагрузке, поэтому `import { defineTool } from "./_sdk.js"` разрешается и
 * в IDE, и в рантайме. Все рантайм-импорты здесь должны разрешаться из
 * node_modules; типы импортируются через `import type`, чтобы исчезнуть.
 */
import type { ToolContext, ToolDefinition, ToolResult } from "../src/lib/types.js";

export type { ToolContext, ToolDefinition, ToolResult };
export { z } from "zod";

/** Тождественный хелпер — нужен только затем, чтобы литерал проверялся типами. */
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
