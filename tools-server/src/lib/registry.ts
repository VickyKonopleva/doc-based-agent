import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema, ToolDefinition } from "./types.js";

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<any>>();

  register(tool: ToolDefinition<any>, source: "builtin" | "dynamic" = "builtin"): void {
    const existing = this.#tools.get(tool.name);
    if (existing && existing.source === "builtin" && source === "dynamic") {
      throw new Error(`tool "${tool.name}" collides with a built-in tool; pick another name`);
    }
    this.#tools.set(tool.name, { ...tool, source });
  }

  unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  /** Drops every tool loaded from the dynamic directory, keeping built-ins. */
  clearDynamic(): void {
    for (const [name, tool] of this.#tools) {
      if (tool.source === "dynamic") this.#tools.delete(name);
    }
  }

  get(name: string): ToolDefinition<any> | undefined {
    return this.#tools.get(name);
  }

  names(): string[] {
    return [...this.#tools.keys()].sort();
  }

  all(): ToolDefinition<any>[] {
    return this.names().map((n) => this.#tools.get(n)!);
  }

  /** MCP `tools/list` payload. */
  describe() {
    return this.all().map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }));
  }
}

export function isZodSchema(schema: unknown): schema is { safeParse: (v: unknown) => any } {
  return typeof schema === "object" && schema !== null && typeof (schema as any).safeParse === "function";
}

export function toJsonSchema(schema: ToolDefinition["inputSchema"]): JsonSchema {
  if (isZodSchema(schema)) {
    const json = zodToJsonSchema(schema as any, { target: "jsonSchema7", $refStrategy: "none" }) as JsonSchema;
    delete (json as any).$schema;
    return json;
  }
  return schema as JsonSchema;
}
