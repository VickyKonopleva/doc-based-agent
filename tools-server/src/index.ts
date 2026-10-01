#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./lib/config.js";
import { createLogger } from "./lib/logger.js";
import { ToolRegistry, isZodSchema } from "./lib/registry.js";
import type { ToolContext, ToolResult } from "./lib/types.js";
import { loadDynamicTools } from "./runtime/dynamic.js";
import { docsTools } from "./tools/docs.js";
import { jiraTools } from "./tools/jira.js";
import { contextTools } from "./tools/context.js";
import { serviceTools } from "./tools/services.js";
import { skillTools } from "./tools/skills.js";
import { specTools } from "./tools/spec.js";
import { toolsmithTools } from "./tools/toolsmith.js";

const config = loadConfig();
const logger = createLogger(config.logLevel, config.logFile);
const registry = new ToolRegistry();

for (const tool of [...contextTools(config), ...docsTools, ...jiraTools(config), ...specTools(config), ...serviceTools(config), ...skillTools(config), ...toolsmithTools]) {
  registry.register(tool, "builtin");
}

const server = new Server(
  { name: "ai-tools-server", version: "0.1.0" },
  { capabilities: { tools: { listChanged: true } } },
);

const ctx: ToolContext = {
  config,
  logger,
  listToolNames: () => registry.names(),
  async reloadDynamicTools() {
    const report = await loadDynamicTools(registry, config, logger);
    try {
      await server.sendToolListChanged();
    } catch (err) {
      // Клиенты без поддержки listChanged просто перечитают список сами.
      logger.debug("tools/list_changed not delivered", err);
    }
    return report;
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.describe() }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = registry.get(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Неизвестный инструмент "${name}". Доступны: ${registry.names().join(", ")}` }],
      isError: true,
    };
  }

  let input: unknown = args ?? {};
  if (isZodSchema(tool.inputSchema)) {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return { content: [{ type: "text", text: `Неверные аргументы для "${name}": ${issues}` }], isError: true };
    }
    input = parsed.data;
  }

  const started = Date.now();
  try {
    const result = await tool.handler(input, ctx);
    const normalized: ToolResult =
      typeof result === "string" ? { content: [{ type: "text", text: result }] } : result;
    logger.debug("tool call finished", { name, ms: Date.now() - started, isError: normalized.isError ?? false });
    return normalized;
  } catch (err) {
    logger.error("tool call threw", { name, error: err });
    return {
      content: [{ type: "text", text: `Инструмент "${name}" упал: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  await loadDynamicTools(registry, config, logger);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("ai-tools-server ready", {
    tools: registry.names(),
    aiDocs: config.aiDocsPath,
    workspaces: config.services.workspacesDir,
    servicesBase: config.services.gitBase || "(не настроен)",
    jiraProvider: config.jira.provider,
    specProvider: config.spec.provider,
    vcsProvider: config.vcs.provider,
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info(`received ${signal}, shutting down`);
    void server.close().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", reason));

main().catch((err) => {
  logger.error("fatal startup error", err);
  process.exit(1);
});
