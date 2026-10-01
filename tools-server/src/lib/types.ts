import type { z } from "zod";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

export interface ToolContext {
  config: Config;
  logger: Logger;
  /** Re-read the dynamic tool directory and push tools/list_changed to the client. */
  reloadDynamicTools(): Promise<{ loaded: string[]; failed: { file: string; error: string }[] }>;
  /** Tool names currently exposed to the model. */
  listToolNames(): string[];
}

export interface ToolResultContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  /** The MCP result type is open; this keeps structural compatibility with the SDK. */
  [key: string]: unknown;
  content: ToolResultContent[];
  isError?: boolean;
  /** Optional machine-readable payload; clients that ignore it still get `content`. */
  structuredContent?: Record<string, unknown>;
}

/** A JSON Schema object, for tools authored without zod. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition<I = unknown> {
  name: string;
  title?: string;
  description: string;
  /** zod schema (preferred) or a raw JSON Schema object. */
  inputSchema: z.ZodType<I> | JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /** Set by the loader for tools read from the dynamic directory. */
  source?: "builtin" | "dynamic";
  sourceFile?: string;
  handler(input: I, ctx: ToolContext): Promise<ToolResult | string>;
}

/** Identity helper that gives agent-authored tool files full type inference. */
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
