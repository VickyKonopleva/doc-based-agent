/**
 * The surface agent-authored tools are written against.
 *
 * Tool files live here, but they are executed from tools-server/.cache after
 * transpilation — the loader compiles this shim to .cache/_sdk.js on every
 * reload, which is why `import { defineTool } from "./_sdk.js"` resolves both
 * in the IDE and at runtime. Keep every runtime import in this file resolvable
 * from node_modules; types are imported with `import type` so they disappear.
 */
import type { ToolContext, ToolDefinition, ToolResult } from "../src/lib/types.js";

export type { ToolContext, ToolDefinition, ToolResult };
export { z } from "zod";

/** Identity helper — exists purely so the object literal gets type-checked. */
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
