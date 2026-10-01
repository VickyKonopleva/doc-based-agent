import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema, ToolDefinition } from "./types.js";

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<any>>();

  register(tool: ToolDefinition<any>, source: "builtin" | "dynamic" = "builtin"): void {
    const existing = this.#tools.get(tool.name);
    if (existing && existing.source === "builtin" && source === "dynamic") {
      throw new Error(`имя "${tool.name}" занято встроенным инструментом, выбери другое`);
    }
    this.#tools.set(tool.name, { ...tool, source });
  }

  unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  /** Выбрасывает инструменты из каталога dynamic, встроенные остаются. */
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

  /** Полезная нагрузка для MCP `tools/list`. */
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
