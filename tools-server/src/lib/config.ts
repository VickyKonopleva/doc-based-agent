import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** tools-server/ — works both from src/ (tsx) and dist/ (node). */
export const SERVER_ROOT = path.resolve(here, "..", "..");
/** Repository root that holds .gigacode/, ai-docs/ and tools-server/. */
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

export type JiraProvider = "local" | "external" | "mock";
export type SpecProvider = "gitlab" | "github" | "bitbucket" | "mock";
export type VcsProvider = "gitlab" | "github" | "bitbucket" | "none";

/**
 * GigaCode launches this server with `npx tsx …` and no `env` block, so the
 * server loads its own secrets. Values already present in the environment win,
 * which keeps CI and `{env:…}` substitution in settings.json working.
 */
function loadDotEnv(file: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(env(name), 10);
  return Number.isFinite(v) ? v : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const v = env(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
}

function resolveFromProject(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

export interface Config {
  /**
   * Documentation base the whole agent is built around. It lives OUTSIDE this
   * repository — a local checkout or a clone of the GitLab repo — and is
   * pointed at by AI_DOCS_PATH.
   */
  aiDocsPath: string;
  /** Where that base comes from, used in error messages and by sync-ai-docs.sh. */
  aiDocsGitUrl: string;
  aiDocsRef: string;
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

  /** Repository of system-analysis specifications. The PR there is the task. */
  spec: {
    provider: SpecProvider;
    baseUrl: string;
    token: string;
    projectId: string;
    mockDir: string;
    /** Which changed files count as specification worth reading in full. */
    filePatterns: string[];
    maxFileBytes: number;
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
  loadDotEnv(path.join(PROJECT_ROOT, ".env"));

  const cfg: Config = {
    aiDocsPath: resolveFromProject(env("AI_DOCS_PATH", "ai-docs")),
    aiDocsGitUrl: env("AI_DOCS_GIT_URL"),
    aiDocsRef: env("AI_DOCS_REF", "master"),
    workspacePath: resolveFromProject(env("WORKSPACE_PATH", process.cwd())),
    dynamicDir: resolveFromProject(env("TOOLS_DYNAMIC_DIR", path.join("tools-server", "dynamic"))),
    cacheDir: path.join(SERVER_ROOT, ".cache"),
    allowDynamicTools: bool("TOOLS_ALLOW_DYNAMIC", true),

    jira: {
      provider: env("JIRA_PROVIDER", "local") as JiraProvider,
      baseUrl: env("JIRA_BASE_URL").replace(/\/+$/, ""),
      auth: env("JIRA_AUTH", "bearer") === "basic" ? "basic" : "bearer",
      token: env("JIRA_TOKEN"),
      email: env("JIRA_EMAIL"),
      mockDir: resolveFromProject(env("JIRA_MOCK_DIR", path.join("tools-server", "fixtures", "jira"))),
    },

    spec: {
      provider: env("SPEC_PROVIDER", "gitlab") as SpecProvider,
      baseUrl: env("SPEC_BASE_URL", env("VCS_BASE_URL")).replace(/\/+$/, ""),
      token: env("SPEC_TOKEN", env("VCS_TOKEN")),
      projectId: env("SPEC_PROJECT_ID"),
      mockDir: resolveFromProject(env("SPEC_MOCK_DIR", path.join("tools-server", "fixtures", "spec"))),
      filePatterns: list("SPEC_FILE_PATTERNS", [".md", ".markdown", ".yaml", ".yml", ".json", ".puml", ".adoc"]),
      maxFileBytes: int("SPEC_MAX_FILE_BYTES", 200_000),
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
