import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Config } from "../lib/config.js";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

const run = promisify(execFile);
const SERVICE_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Любая форма префикса — ssh, https или локальный путь — склеивается одинаково. */
function repoUrl(cfg: Config, service: string): string {
  const base = cfg.services.gitBase;
  const joined = base.endsWith("/") || base.endsWith(":") ? `${base}${service}` : `${base}/${service}`;
  return joined.endsWith(".git") ? joined : `${joined}.git`;
}

/** Адрес репозитория в API: Bitbucket — КЛЮЧ/slug, остальные — группа/сервис. */
export function projectPath(cfg: Config, service: string): string {
  return cfg.services.group ? `${cfg.services.group}/${service}` : service;
}

/**
 * Токен в URL не кладём: он утёк бы в `git remote -v` и в логи.
 * Для https передаём заголовок только на время вызова.
 */
function gitArgs(cfg: Config, args: string[]): string[] {
  const needsHeader = cfg.services.token && /^https?:\/\//.test(cfg.services.gitBase);
  return needsHeader
    ? ["-c", `http.extraheader=Authorization: Bearer ${cfg.services.token}`, ...args]
    : args;
}

function scrub(message: string, cfg: Config): string {
  return cfg.services.token ? message.split(cfg.services.token).join("***") : message;
}

async function git(cfg: Config, cwd: string | undefined, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", gitArgs(cfg, args), {
      cwd,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || err).trim();
    throw new Error(scrub(detail.split("\n").slice(0, 6).join("\n"), cfg));
  }
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Кандидаты имени: как попросили и с обязательным суффиксом. */
function candidates(cfg: Config, service: string): string[] {
  const name = service.trim().replace(/\.git$/, "").replace(/^.*\//, "");
  const suffix = cfg.services.suffix;
  return suffix && !name.endsWith(suffix) ? [name + suffix, name] : [name];
}

// ───────────────────────────── service_list ─────────────────────────────

async function fetchServiceNames(cfg: Config): Promise<string[]> {
  const s = cfg.services;

  if (s.provider === "bitbucket") {
    const url = `${s.apiUrl}/rest/api/1.0/projects/${encodeURIComponent(s.group)}/repos?limit=1000`;
    const response = await fetch(url, {
      headers: s.token ? { Authorization: `Bearer ${s.token}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
    const body = (await response.json()) as any;
    return (body.values ?? []).map((r: any) => r.slug);
  }

  if (s.provider === "mock") {
    const raw = JSON.parse(await fs.readFile(path.join(s.mockDir, "index.json"), "utf8"));
    return (raw.services ?? []).map(String);
  }

  if (s.provider === "github") {
    const url = `${s.apiUrl}/orgs/${encodeURIComponent(s.group)}/repos?per_page=100&type=all`;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
    return ((await response.json()) as any[]).map((r) => r.name);
  }

  const url =
    `${s.apiUrl}/api/v4/groups/${encodeURIComponent(s.group)}/projects` +
    `?per_page=100&simple=true&include_subgroups=true&archived=false`;
  const response = await fetch(url, {
    headers: s.token ? { "PRIVATE-TOKEN": s.token } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${url}`);
  return ((await response.json()) as any[]).map((p) => p.path);
}

export const serviceList: ToolDefinition<{ query?: string }> = defineTool({
  name: "service_list",
  title: "Список backend-сервисов",
  description:
    "Перечислить репозитории backend-микросервисов в нашем проекте Bitbucket. " +
    "Используй, чтобы сверить догадку о затронутом сервисе с тем, что существует на самом деле: " +
    "имя из спецификации или тикета может отличаться от имени репозитория. " +
    "Клонировать репозиторий не нужно — это делает service_checkout.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: z.object({
    query: z.string().optional().describe("Подстрока для фильтра, например 'payment'. Без неё вернётся весь список."),
  }),
  async handler(input, ctx) {
    const s = ctx.config.services;
    if (s.provider !== "mock") {
      if (!s.apiUrl) return failure("SERVICES_API_URL (или VCS_BASE_URL) не настроен.");
      if (!s.group) return failure("SERVICES_GROUP не настроен — неизвестно, в каком проекте искать сервисы.");
    }

    let names: string[];
    try {
      names = await fetchServiceNames(ctx.config);
    } catch (err) {
      return failure(`Не удалось получить список сервисов: ${scrub(err instanceof Error ? err.message : String(err), ctx.config)}`);
    }

    const q = input.query?.toLowerCase();
    const filtered = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
    const backend = filtered.filter((n) => !s.suffix || n.endsWith(s.suffix)).sort();
    const other = filtered.filter((n) => s.suffix && !n.endsWith(s.suffix)).sort();

    if (!filtered.length) {
      return text(
        `По фильтру "${input.query ?? ""}" ничего не найдено. Всего в проекте ${s.group}: ${names.length} репозиториев.\n` +
          "Вызови без query, чтобы увидеть весь список.",
      );
    }

    return text(
      [
        `Проект ${s.group}, найдено ${filtered.length}${q ? ` по фильтру "${input.query}"` : ""}.`,
        "",
        `Backend-сервисы (${s.suffix}):`,
        ...backend.map((n) => `  ${n}`),
        ...(other.length ? ["", "Прочие репозитории:", ...other.map((n) => `  ${n}`)] : []),
        "",
        "Выкачать нужный: service_checkout({ service: \"<имя>\" }).",
      ].join("\n"),
      { services: backend, other, group: s.group },
    );
  },
});

// ─────────────────────────── service_checkout ───────────────────────────

export const serviceCheckout: ToolDefinition<{
  service: string;
  branch?: string;
  baseBranch?: string;
}> = defineTool({
  name: "service_checkout",
  title: "Выкачать сервис",
  description:
    "Склонировать репозиторий сервиса (или обновить уже склонированный) и вернуть путь к локальной рабочей копии. " +
    "Полный адрес достраивается из общего префикса SERVICES_GIT_BASE и имени сервиса; суффикс добавляется автоматически. " +
    "Вызывай для каждого сервиса, который задевает задача. Можно сразу создать рабочую ветку от свежего целевого бранча.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: z.object({
    service: z.string().describe("Имя сервиса, например 'payment' или 'payment-be'. Суффикс добавится сам, если его нет."),
    branch: z.string().optional().describe("Рабочая ветка, которую нужно создать или переключиться на неё, например 'feature/BACK-1234-retry'."),
    baseBranch: z.string().optional().describe("От чего ответвляться и что подтягивать. По умолчанию SERVICES_DEFAULT_BRANCH."),
  }),
  async handler(input, ctx) {
    const cfg = ctx.config;
    const s = cfg.services;

    if (!s.gitBase) {
      return failure(
        "SERVICES_GIT_BASE не настроен — неизвестно, по какому префиксу собирать адрес репозитория.\n" +
          "Пример для Bitbucket Server: SERVICES_GIT_BASE=ssh://git@bitbucket.company.ru:7999/be/",
      );
    }
    if (!SERVICE_NAME.test(input.service.trim().replace(/\.git$/, "").replace(/^.*\//, ""))) {
      return failure(`"${input.service}" не похоже на имя сервиса.`);
    }

    const base = input.baseBranch ?? s.defaultBranch;
    await fs.mkdir(s.workspacesDir, { recursive: true });

    // Если копия уже есть — работаем с ней, иначе пробуем имена по очереди.
    const tried: { name: string; error: string }[] = [];
    let name: string | null = null;
    let dest = "";

    for (const candidate of candidates(cfg, input.service)) {
      const dir = path.join(s.workspacesDir, candidate);
      if (await isGitRepo(dir)) {
        name = candidate;
        dest = dir;
        break;
      }
    }

    if (!name) {
      for (const candidate of candidates(cfg, input.service)) {
        const dir = path.join(s.workspacesDir, candidate);
        const url = repoUrl(cfg, candidate);
        const args = ["clone", ...(s.cloneDepth > 0 ? ["--depth", String(s.cloneDepth)] : []), url, dir];
        try {
          await git(cfg, undefined, args);
          name = candidate;
          dest = dir;
          break;
        } catch (err) {
          tried.push({ name: candidate, error: err instanceof Error ? err.message : String(err) });
          await fs.rm(dir, { recursive: true, force: true });
        }
      }
    }

    if (!name) {
      return failure(
        `Не удалось выкачать сервис "${input.service}". Пробовал:\n` +
          tried.map((t) => `  ${repoUrl(cfg, t.name)}\n    ${t.error.split("\n")[0]}`).join("\n") +
          "\n\nСверь имя через service_list — в репозитории оно может называться иначе.",
      );
    }

    // Уже существующая копия: не трогаем незакоммиченные изменения.
    const dirty = (await git(cfg, dest, ["status", "--porcelain"]).catch(() => "")).length > 0;
    const notes: string[] = [];

    try {
      await git(cfg, dest, ["fetch", "--prune", "origin"]);
    } catch (err) {
      notes.push(`fetch не прошёл: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }

    if (dirty) {
      notes.push("в рабочей копии есть незакоммиченные изменения — ветку не переключал, разберись сам");
    } else {
      try {
        if (input.branch) {
          const exists = await git(cfg, dest, ["branch", "--list", input.branch]).catch(() => "");
          if (exists) await git(cfg, dest, ["switch", input.branch]);
          else await git(cfg, dest, ["switch", "-c", input.branch, `origin/${base}`]);
        } else {
          await git(cfg, dest, ["switch", base]);
          await git(cfg, dest, ["reset", "--hard", `origin/${base}`]);
        }
      } catch (err) {
        notes.push(`переключение ветки не прошло: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }

    const head = await git(cfg, dest, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "?");
    const sha = await git(cfg, dest, ["rev-parse", "--short", "HEAD"]).catch(() => "?");

    ctx.logger.info("service checked out", { service: name, dest, branch: head });

    return text(
      [
        `Сервис ${name} готов.`,
        `  путь:    ${dest}`,
        `  ветка:   ${head} (${sha})`,
        `  база:    origin/${base}`,
        `  репо:    ${projectPath(cfg, name)}`,
        ...(notes.length ? ["", "Внимание:", ...notes.map((n) => `  ${n}`)] : []),
        "",
        "Дальше работай по этому пути: читай код, вноси правки, запускай сборку из него.",
      ].join("\n"),
      { service: name, path: dest, branch: head, head: sha, baseBranch: base, project: projectPath(cfg, name) },
    );
  },
});

/**
 * При SERVICES_PROVIDER=external список репозиториев отдаёт внешний MCP-сервер
 * Bitbucket. service_checkout остаётся в любом случае: он ходит обычным git,
 * API ему не нужен.
 */
export function serviceTools(cfg: Config): ToolDefinition<any>[] {
  return cfg.services.provider === "external" ? [serviceCheckout] : [serviceList, serviceCheckout];
}
