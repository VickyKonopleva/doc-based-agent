import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import type { Config } from "../lib/config.js";
import type { Logger } from "../lib/logger.js";
import type { ToolDefinition } from "../lib/types.js";
import type { ToolRegistry } from "../lib/registry.js";

export const TOOL_FILE_RE = /\.tool\.(ts|mts|js|mjs)$/;

export interface LoadReport {
  loaded: string[];
  failed: { file: string; error: string }[];
}

/**
 * Инструменты, написанные агентом, лежат обычными исходниками в `dynamic/`.
 * TypeScript транспилируется в памяти, результат кладётся в `.cache/` (внутри
 * tools-server, чтобы работало разрешение node_modules) и импортируется с
 * хешем содержимого в имени — именно это позволяет перезагружать их без
 * рестарта процесса.
 */
export async function loadDynamicTools(
  registry: ToolRegistry,
  config: Config,
  logger: Logger,
): Promise<LoadReport> {
  const report: LoadReport = { loaded: [], failed: [] };

  if (!config.allowDynamicTools) {
    logger.warn("dynamic tools are disabled (TOOLS_ALLOW_DYNAMIC=false)");
    return report;
  }

  registry.clearDynamic();
  await compileSdkShim(config);

  let entries: string[];
  try {
    entries = (await fs.readdir(config.dynamicDir)).filter((f) => TOOL_FILE_RE.test(f)).sort();
  } catch (err) {
    logger.warn("dynamic tool directory is unreadable", err);
    return report;
  }

  for (const file of entries) {
    const abs = path.join(config.dynamicDir, file);
    try {
      const tools = await importToolFile(abs, config);
      for (const tool of tools) {
        registry.register({ ...tool, sourceFile: file }, "dynamic");
        report.loaded.push(tool.name);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ file, error: message });
      logger.error(`failed to load dynamic tool file ${file}`, err);
    }
  }

  logger.info("dynamic tools loaded", report);
  return report;
}

/**
 * Compiles `dynamic/_sdk.ts` to a stable `.cache/_sdk.js` so that the
 * `import { defineTool } from "./_sdk.js"` written in every tool file resolves
 * from the cache directory it actually runs in.
 */
async function compileSdkShim(config: Config): Promise<void> {
  const src = path.join(config.dynamicDir, "_sdk.ts");
  let source: string;
  try {
    source = await fs.readFile(src, "utf8");
  } catch {
    return; // в этом чекауте шима нет; инструменты могут импортировать "zod" напрямую
  }
  const { code } = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
    target: "node20",
    sourcefile: src,
  });
  await fs.writeFile(path.join(config.cacheDir, "_sdk.js"), code, "utf8");
}

/** Компилирует и импортирует один файл, возвращая все объявленные в нём инструменты. */
export async function importToolFile(abs: string, config: Config): Promise<ToolDefinition<any>[]> {
  await compileSdkShim(config);
  const source = await fs.readFile(abs, "utf8");
  const hash = crypto.createHash("sha1").update(source).digest("hex").slice(0, 12);
  const base = path.basename(abs).replace(TOOL_FILE_RE, "");
  const outFile = path.join(config.cacheDir, `${base}.${hash}.mjs`);

  const needsTranspile = /\.(ts|mts)$/.test(abs);
  const code = needsTranspile
    ? (await esbuild.transform(source, {
        loader: "ts",
        format: "esm",
        target: "node20",
        sourcefile: abs,
      })).code
    : source;

  await fs.writeFile(outFile, code, "utf8");

  const mod = (await import(pathToFileURL(outFile).href)) as Record<string, unknown>;
  const candidates = [mod.default, mod.tool, ...Object.values(mod)];
  const tools: ToolDefinition<any>[] = [];
  const seen = new Set<unknown>();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) if (isToolDefinition(item)) tools.push(item);
    } else if (isToolDefinition(candidate)) {
      tools.push(candidate);
    }
  }

  if (tools.length === 0) {
    throw new Error(
      `${path.basename(abs)} не экспортирует инструмент: ожидается "export default defineTool({ name, description, inputSchema, handler })"`,
    );
  }
  return tools;
}

function isToolDefinition(value: unknown): value is ToolDefinition<any> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ToolDefinition>;
  return (
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.handler === "function" &&
    typeof v.inputSchema === "object" &&
    v.inputSchema !== null
  );
}
