import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** tools-server/ — works both from src/ (tsx) and dist/ (node). */
export const SERVER_ROOT = path.resolve(here, "..", "..");
/** Repository root that holds .gigacode/, ai-docs/ and tools-server/. */
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

export type JiraProvider = "local" | "external" | "mock";
export type VcsProvider = "gitlab" | "github" | "bitbucket" | "none";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function resolveFromProject(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

export interface Config {
  /** Documentation base the whole agent is built around. */
  aiDocsPath: string;
  /** Checkout of the service the ticket is about. */
  workspacePath: string;
  /** Where agent-authored tools live. */
  dynamicDir: string;
  cacheDir: string;
  allowDynamicTools: boolean;

  jira: {
    provider: JiraProvider;
    baseUrl: string;
    auth: "bearer" | "basic";
    token: string;
    email: string;
    mockDir: string;
  };

  vcs: {
    provider: VcsProvider;
    baseUrl: string;
    token: string;
    projectId: string;
    defaultTargetBranch: string;
  };

  logLevel: "debug" | "info" | "warn" | "error";
  logFile: string;
}

export function loadConfig(): Config {
  const cfg: Config = {
    aiDocsPath: resolveFromProject(env("AI_DOCS_PATH", "ai-docs")),
    workspacePath: resolveFromProject(env("WORKSPACE_PATH", process.cwd())),
    dynamicDir: resolveFromProject(env("TOOLS_DYNAMIC_DIR", path.join("tools-server", "dynamic"))),
    cacheDir: path.join(SERVER_ROOT, ".cache"),
    allowDynamicTools: bool("TOOLS_ALLOW_DYNAMIC", true),

    jira: {
      provider: env("JIRA_PROVIDER", "local") as JiraProvider,
      baseUrl: env("JIRA_BASE_URL").replace(/\/+$/, ""),
      auth: (env("JIRA_AUTH", "bearer") === "basic" ? "basic" : "bearer"),
      token: env("JIRA_TOKEN"),
      email: env("JIRA_EMAIL"),
      mockDir: resolveFromProject(env("JIRA_MOCK_DIR", path.join("tools-server", "fixtures", "jira"))),
    },

    vcs: {
      provider: env("VCS_PROVIDER", "gitlab") as VcsProvider,
      baseUrl: env("VCS_BASE_URL").replace(/\/+$/, ""),
      token: env("VCS_TOKEN"),
      projectId: env("VCS_PROJECT_ID"),
      defaultTargetBranch: env("VCS_TARGET_BRANCH", "master"),
    },

    logLevel: env("LOG_LEVEL", "info") as Config["logLevel"],
    logFile: env("LOG_FILE", ""),
  };

  if (!fs.existsSync(cfg.dynamicDir)) fs.mkdirSync(cfg.dynamicDir, { recursive: true });
  if (!fs.existsSync(cfg.cacheDir)) fs.mkdirSync(cfg.cacheDir, { recursive: true });

  return cfg;
}
