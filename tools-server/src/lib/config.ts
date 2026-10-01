import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** tools-server/ — работает и из src/ (tsx), и из dist/ (node). */
export const SERVER_ROOT = path.resolve(here, "..", "..");
/** Корень репозитория: .gigacode/, tools-server/ и прочее. */
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

/** `external` — источник отдан внешнему MCP-серверу, наши инструменты не регистрируются. */
export type JiraProvider = "local" | "external" | "mock";
export type SpecProvider = "bitbucket" | "gitlab" | "github" | "external" | "mock";
export type VcsProvider = "bitbucket" | "gitlab" | "github" | "none";

/**
 * GigaCode запускает сервер через `npx tsx …` без блока `env`, поэтому сервер
 * сам читает свои настройки. Значения, уже заданные в окружении, имеют
 * приоритет — так продолжают работать CI и подстановка `{env:…}`.
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
   * База знаний, вокруг которой построен весь агент. Живёт ВНЕ этого
   * репозитория — локальный чекаут или клон — и задаётся через AI_DOCS_PATH.
   */
  aiDocsPath: string;
  /** Откуда база берётся: нужно для текстов ошибок и для sync-ai-docs.sh. */
  aiDocsGitUrl: string;
  aiDocsRef: string;

  /**
   * Backend-микросервисы. Чекаут агенту не выдаётся: он сам определяет, какие
   * сервисы задевает задача, достраивает адрес каждого из общего префикса и
   * клонирует их в workspacesDir.
   */
  services: {
    /** Общий префикс адресов репозиториев, напр. "ssh://git@bitbucket.company.ru:7999/be/". */
    gitBase: string;
    /** Ключ проекта Bitbucket (или группа/организация) для вызовов API. */
    group: string;
    /** Суффикс, который носят все backend-репозитории, напр. "-be". */
    suffix: string;
    /** Куда складываются клоны. */
    workspacesDir: string;
    defaultBranch: string;
    provider: SpecProvider;
    apiUrl: string;
    token: string;
    /** 0 — полный клон. */
    cloneDepth: number;
    mockDir: string;
  };
  /** Where agent-authored tools live. */
  dynamicDir: string;
  cacheDir: string;
  allowDynamicTools: boolean;
  /** .gigacode/ — агент создаёт здесь собственные скилы. */
  gigacodeDir: string;
  allowSkillAuthoring: boolean;

  jira: {
    provider: JiraProvider;
    baseUrl: string;
    auth: "bearer" | "basic";
    token: string;
    email: string;
    mockDir: string;
  };

  /** Репозиторий спецификаций системного анализа. PR в нём — это ТЗ. */
  spec: {
    provider: SpecProvider;
    baseUrl: string;
    token: string;
    projectId: string;
    mockDir: string;
    /** Какие изменённые файлы считать спецификацией. */
    filePatterns: string[];
    maxFileBytes: number;
  };

  /**
   * Nexus. Сервер не умеет искать артефакты и не должен: агент сам решает,
   * как опросить репозиторий по этому адресу. Здесь только координаты.
   */
  nexus: {
    url: string;
    repository: string;
    /** Из имени сервиса получаются имена артефактов: service-be → service-be-api, … */
    artifactSuffixes: string[];
    user: string;
    token: string;
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

    services: {
      gitBase: env("SERVICES_GIT_BASE"),
      group: env("SERVICES_GROUP").replace(/^\/+|\/+$/g, ""),
      suffix: env("SERVICES_SUFFIX", "-be"),
      workspacesDir: resolveFromProject(env("WORKSPACES_DIR", "workspaces")),
      defaultBranch: env("SERVICES_DEFAULT_BRANCH", env("VCS_TARGET_BRANCH", "master")),
      provider: env("SERVICES_PROVIDER", env("VCS_PROVIDER", "bitbucket")) as SpecProvider,
      apiUrl: env("SERVICES_API_URL", env("VCS_BASE_URL")).replace(/\/+$/, ""),
      token: env("SERVICES_TOKEN", env("VCS_TOKEN")),
      cloneDepth: int("SERVICES_CLONE_DEPTH", 0),
      mockDir: resolveFromProject(env("SERVICES_MOCK_DIR", path.join("tools-server", "fixtures", "services"))),
    },
    dynamicDir: resolveFromProject(env("TOOLS_DYNAMIC_DIR", path.join("tools-server", "dynamic"))),
    cacheDir: path.join(SERVER_ROOT, ".cache"),
    allowDynamicTools: bool("TOOLS_ALLOW_DYNAMIC", true),
    gigacodeDir: resolveFromProject(env("GIGACODE_DIR", ".gigacode")),
    allowSkillAuthoring: bool("SKILLS_ALLOW_CREATE", true),

    jira: {
      provider: env("JIRA_PROVIDER", "local") as JiraProvider,
      baseUrl: env("JIRA_BASE_URL").replace(/\/+$/, ""),
      auth: env("JIRA_AUTH", "bearer") === "basic" ? "basic" : "bearer",
      token: env("JIRA_TOKEN"),
      email: env("JIRA_EMAIL"),
      mockDir: resolveFromProject(env("JIRA_MOCK_DIR", path.join("tools-server", "fixtures", "jira"))),
    },

    spec: {
      provider: env("SPEC_PROVIDER", "bitbucket") as SpecProvider,
      baseUrl: env("SPEC_BASE_URL", env("VCS_BASE_URL")).replace(/\/+$/, ""),
      token: env("SPEC_TOKEN", env("VCS_TOKEN")),
      projectId: env("SPEC_PROJECT_ID"),
      mockDir: resolveFromProject(env("SPEC_MOCK_DIR", path.join("tools-server", "fixtures", "spec"))),
      filePatterns: list("SPEC_FILE_PATTERNS", [".md", ".markdown", ".yaml", ".yml", ".json", ".puml", ".adoc"]),
      maxFileBytes: int("SPEC_MAX_FILE_BYTES", 200_000),
    },

    nexus: {
      url: env("NEXUS_URL").replace(/\/+$/, ""),
      repository: env("NEXUS_REPOSITORY"),
      artifactSuffixes: list("NEXUS_ARTIFACT_SUFFIXES", ["-api", "-roles-pprb"]),
      user: env("NEXUS_USER"),
      token: env("NEXUS_TOKEN"),
    },

    vcs: {
      provider: env("VCS_PROVIDER", "bitbucket") as VcsProvider,
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
