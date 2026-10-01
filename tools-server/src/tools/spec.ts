import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Config } from "../lib/config.js";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

/** Общая форма, в которую приводятся все провайдеры — чтобы `mock` вёл себя так же. */
export interface SpecPullRequest {
  number: number;
  title: string;
  description: string;
  author: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  /** Ключи Jira, упомянутые в PR — для сверки с переданным тикетом. */
  tickets: string[];
  files: { path: string; status: string; isSpec: boolean }[];
  discussions: { author: string; body: string; file?: string; resolved?: boolean }[];
}

const TICKET_IN_TEXT = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

/** Принимает 123, #123, !123 или полную ссылку на pull request. */
export function parsePrNumber(input: string): number | null {
  const trimmed = String(input).trim();
  const fromUrl = trimmed.match(/\/(?:pull-requests|merge_requests|pulls?)\/(\d+)/);
  const raw = fromUrl?.[1] ?? trimmed.replace(/^[!#]/, "");
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isSpecFile(file: string, cfg: Config): boolean {
  const lower = file.toLowerCase();
  return cfg.spec.filePatterns.some((p) => lower.endsWith(p.toLowerCase()));
}

function collectTickets(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.match(TICKET_IN_TEXT) ?? []) found.add(m);
  return [...found].sort();
}

async function httpJson(url: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} for ${url}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  return response.json();
}

/** Bitbucket Server: projectKey/repoSlug из SPEC_PROJECT_ID. */
function bitbucketRepo(cfg: Config): { project: string; slug: string } {
  const [project, slug] = cfg.spec.projectId.split("/");
  if (!project || !slug) {
    throw new Error(`Для Bitbucket нужен SPEC_PROJECT_ID вида "КЛЮЧПРОЕКТА/repo-slug", получено "${cfg.spec.projectId}"`);
  }
  return { project, slug };
}

/** Токен необязателен: локальный Bitbucket может быть доступен без авторизации. */
function bitbucketHeaders(cfg: Config): Record<string, string> {
  return cfg.spec.token ? { Authorization: `Bearer ${cfg.spec.token}` } : {};
}

function bitbucketApi(cfg: Config): string {
  const { project, slug } = bitbucketRepo(cfg);
  return `${cfg.spec.baseUrl}/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(slug)}`;
}

function gitlabHeaders(cfg: Config): Record<string, string> {
  return { "PRIVATE-TOKEN": cfg.spec.token };
}

function githubHeaders(cfg: Config): Record<string, string> {
  return { Authorization: `Bearer ${cfg.spec.token}`, Accept: "application/vnd.github+json" };
}

function projectPath(cfg: Config): string {
  return encodeURIComponent(cfg.spec.projectId);
}

// ───────────────────────────── providers ─────────────────────────────

async function fetchBitbucket(cfg: Config, n: number): Promise<SpecPullRequest> {
  const base = bitbucketApi(cfg);
  const headers = bitbucketHeaders(cfg);

  const pr = await httpJson(`${base}/pull-requests/${n}`, headers);
  const changes = await httpJson(`${base}/pull-requests/${n}/changes?limit=1000`, headers);
  const activities = await httpJson(`${base}/pull-requests/${n}/activities?limit=100`, headers).catch(() => ({ values: [] }));

  const STATUS: Record<string, string> = { ADD: "added", MODIFY: "modified", DELETE: "deleted", MOVE: "renamed", COPY: "added" };
  const files = (changes.values ?? []).map((c: any) => {
    const filePath = c.path?.toString ?? c.path?.toString?.() ?? String(c.path ?? "");
    return { path: filePath, status: STATUS[c.type] ?? String(c.type ?? "modified").toLowerCase(), isSpec: isSpecFile(filePath, cfg) };
  });

  // Комментарии лежат в ленте активностей; ответы вложены в comment.comments.
  const discussions: SpecPullRequest["discussions"] = [];
  const walk = (comment: any, file?: string) => {
    if (!comment) return;
    discussions.push({
      author: comment.author?.displayName ?? "",
      body: String(comment.text ?? "").trim(),
      file,
      // В Bitbucket Server «нерешённость» выражена открытой задачей на комментарии.
      resolved: comment.severity === "BLOCKER" ? comment.state === "RESOLVED" : undefined,
    });
    for (const reply of comment.comments ?? []) walk(reply, file);
  };
  for (const a of activities.values ?? []) {
    if (a.action !== "COMMENTED") continue;
    walk(a.comment, a.commentAnchor?.path);
  }

  const source = pr.fromRef?.displayId ?? "";
  return {
    number: pr.id,
    title: pr.title ?? "",
    description: pr.description ?? "",
    author: pr.author?.user?.displayName ?? "",
    state: pr.draft ? "draft" : String(pr.state ?? "").toLowerCase(),
    sourceBranch: source,
    targetBranch: pr.toRef?.displayId ?? "",
    webUrl: pr.links?.self?.[0]?.href ?? "",
    tickets: collectTickets(pr.title ?? "", pr.description ?? "", source),
    files,
    discussions,
  };
}

async function fetchGitlab(cfg: Config, n: number): Promise<SpecPullRequest> {
  const base = `${cfg.spec.baseUrl}/api/v4/projects/${projectPath(cfg)}/merge_requests/${n}`;
  const mr = await httpJson(base, gitlabHeaders(cfg));
  const changes = await httpJson(`${base}/changes`, gitlabHeaders(cfg));
  const discussions = await httpJson(`${base}/discussions`, gitlabHeaders(cfg)).catch(() => []);

  const files = (changes.changes ?? []).map((c: any) => ({
    path: c.new_path ?? c.old_path,
    status: c.new_file ? "added" : c.deleted_file ? "deleted" : c.renamed_file ? "renamed" : "modified",
    isSpec: isSpecFile(c.new_path ?? c.old_path, cfg),
  }));

  const notes = (discussions as any[]).flatMap((d) =>
    (d.notes ?? [])
      .filter((note: any) => !note.system)
      .map((note: any) => ({
        author: note.author?.name ?? "",
        body: String(note.body ?? "").trim(),
        file: note.position?.new_path,
        resolved: note.resolved ?? undefined,
      })),
  );

  return {
    number: mr.iid,
    title: mr.title ?? "",
    description: mr.description ?? "",
    author: mr.author?.name ?? "",
    state: mr.state ?? "",
    sourceBranch: mr.source_branch ?? "",
    targetBranch: mr.target_branch ?? "",
    webUrl: mr.web_url ?? "",
    tickets: collectTickets(mr.title ?? "", mr.description ?? "", mr.source_branch ?? ""),
    files,
    discussions: notes,
  };
}

function githubRepo(cfg: Config): { owner: string; repo: string } {
  const [owner, repo] = cfg.spec.projectId.split("/");
  if (!owner || !repo) throw new Error(`SPEC_PROJECT_ID must be "owner/repo" for GitHub, got "${cfg.spec.projectId}"`);
  return { owner, repo };
}

async function fetchGithub(cfg: Config, n: number): Promise<SpecPullRequest> {
  const { owner, repo } = githubRepo(cfg);
  const base = `${cfg.spec.baseUrl}/repos/${owner}/${repo}`;
  const pr = await httpJson(`${base}/pulls/${n}`, githubHeaders(cfg));
  const files = await httpJson(`${base}/pulls/${n}/files?per_page=100`, githubHeaders(cfg));
  const comments = await httpJson(`${base}/issues/${n}/comments?per_page=100`, githubHeaders(cfg)).catch(() => []);
  const reviewComments = await httpJson(`${base}/pulls/${n}/comments?per_page=100`, githubHeaders(cfg)).catch(() => []);

  return {
    number: pr.number,
    title: pr.title ?? "",
    description: pr.body ?? "",
    author: pr.user?.login ?? "",
    state: pr.draft ? "draft" : (pr.state ?? ""),
    sourceBranch: pr.head?.ref ?? "",
    targetBranch: pr.base?.ref ?? "",
    webUrl: pr.html_url ?? "",
    tickets: collectTickets(pr.title ?? "", pr.body ?? "", pr.head?.ref ?? ""),
    files: (files as any[]).map((f) => ({ path: f.filename, status: f.status, isSpec: isSpecFile(f.filename, cfg) })),
    discussions: [
      ...(comments as any[]).map((c) => ({ author: c.user?.login ?? "", body: String(c.body ?? "").trim() })),
      ...(reviewComments as any[]).map((c) => ({
        author: c.user?.login ?? "",
        body: String(c.body ?? "").trim(),
        file: c.path,
      })),
    ],
  };
}

async function fetchMock(cfg: Config, n: number): Promise<SpecPullRequest> {
  const file = path.join(cfg.spec.mockDir, `${n}.json`);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  const files = (raw.files ?? []).map((f: any) => ({
    path: f.path,
    status: f.status ?? "modified",
    isSpec: isSpecFile(f.path, cfg),
  }));
  return {
    number: raw.number ?? n,
    title: raw.title ?? "",
    description: raw.description ?? "",
    author: raw.author ?? "",
    state: raw.state ?? "opened",
    sourceBranch: raw.sourceBranch ?? "",
    targetBranch: raw.targetBranch ?? "",
    webUrl: raw.webUrl ?? "",
    tickets: collectTickets(raw.title ?? "", raw.description ?? "", raw.sourceBranch ?? ""),
    files,
    discussions: raw.discussions ?? [],
  };
}

async function fetchPr(cfg: Config, n: number): Promise<SpecPullRequest> {
  switch (cfg.spec.provider) {
    case "mock": return fetchMock(cfg, n);
    case "github": return fetchGithub(cfg, n);
    case "gitlab": return fetchGitlab(cfg, n);
    case "bitbucket": return fetchBitbucket(cfg, n);
    default: throw new Error(`SPEC_PROVIDER="${cfg.spec.provider}" не поддерживается. Добавь провайдер через tool_create.`);
  }
}

// ───────────────────────────── file bodies ─────────────────────────────

async function readFileContent(cfg: Config, pr: SpecPullRequest, filePath: string): Promise<string> {
  if (cfg.spec.provider === "bitbucket") {
    const url = `${bitbucketApi(cfg)}/raw/${filePath.split("/").map(encodeURIComponent).join("/")}` +
      `?at=${encodeURIComponent(`refs/heads/${pr.sourceBranch}`)}`;
    const response = await fetch(url, { headers: bitbucketHeaders(cfg), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${filePath}`);
    return response.text();
  }

  if (cfg.spec.provider === "mock") {
    const raw = JSON.parse(await fs.readFile(path.join(cfg.spec.mockDir, `${pr.number}.json`), "utf8"));
    const found = (raw.files ?? []).find((f: any) => f.path === filePath);
    if (!found) throw new Error(`file "${filePath}" is not part of PR ${pr.number}`);
    return String(found.content ?? "");
  }

  if (cfg.spec.provider === "gitlab") {
    const url =
      `${cfg.spec.baseUrl}/api/v4/projects/${projectPath(cfg)}/repository/files/` +
      `${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(pr.sourceBranch)}`;
    const response = await fetch(url, { headers: gitlabHeaders(cfg), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${filePath}`);
    return response.text();
  }

  const { owner, repo } = githubRepo(cfg);
  const url = `${cfg.spec.baseUrl}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(pr.sourceBranch)}`;
  const response = await fetch(url, {
    headers: { ...githubHeaders(cfg), Accept: "application/vnd.github.raw" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${filePath}`);
  return response.text();
}

async function readFileDiff(cfg: Config, pr: SpecPullRequest, filePath: string): Promise<string> {
  if (cfg.spec.provider === "bitbucket") {
    const url = `${bitbucketApi(cfg)}/pull-requests/${pr.number}.diff?path=${encodeURIComponent(filePath)}&contextLines=3`;
    const response = await fetch(url, {
      headers: { ...bitbucketHeaders(cfg), Accept: "text/plain" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} для ${filePath}`);
    return response.text();
  }

  if (cfg.spec.provider === "mock") {
    const raw = JSON.parse(await fs.readFile(path.join(cfg.spec.mockDir, `${pr.number}.json`), "utf8"));
    const found = (raw.files ?? []).find((f: any) => f.path === filePath);
    return String(found?.diff ?? "(фикстура не содержит diff для этого файла)");
  }

  if (cfg.spec.provider === "gitlab") {
    const changes = await httpJson(
      `${cfg.spec.baseUrl}/api/v4/projects/${projectPath(cfg)}/merge_requests/${pr.number}/changes`,
      gitlabHeaders(cfg),
    );
    const found = (changes.changes ?? []).find((c: any) => (c.new_path ?? c.old_path) === filePath);
    if (!found) throw new Error(`file "${filePath}" is not part of MR !${pr.number}`);
    return String(found.diff ?? "");
  }

  const { owner, repo } = githubRepo(cfg);
  const files = await httpJson(`${cfg.spec.baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`, githubHeaders(cfg));
  const found = (files as any[]).find((f) => f.filename === filePath);
  if (!found) throw new Error(`file "${filePath}" is not part of PR #${pr.number}`);
  return String(found.patch ?? "(binary or too large to diff)");
}

// ───────────────────────────── rendering ─────────────────────────────

function render(pr: SpecPullRequest, cfg: Config): string {
  const specFiles = pr.files.filter((f) => f.isSpec);
  const otherFiles = pr.files.filter((f) => !f.isSpec);
  const section = (title: string, body: string) => (body.trim() ? `\n## ${title}\n${body.trim()}\n` : "");

  return [
    `# PR аналитики #${pr.number}: ${pr.title}`,
    "",
    [
      `state: ${pr.state}`,
      `author: ${pr.author}`,
      `source: ${pr.sourceBranch} → ${pr.targetBranch}`,
      pr.tickets.length ? `tickets mentioned: ${pr.tickets.join(", ")}` : "tickets mentioned: (none)",
      pr.webUrl ? `url: ${pr.webUrl}` : "",
    ].filter(Boolean).join("\n"),
    section("Описание PR", pr.description || "_(пусто)_"),
    section(
      "Файлы спецификации",
      specFiles.length
        ? specFiles.map((f) => `- [${f.status}] ${f.path}`).join("\n") +
          `\n\nЧитай каждый из них целиком: spec_read_file({ pr: ${pr.number}, path: "<путь>" }).`
        : "_PR не меняет ни одного файла, похожего на спецификацию._",
    ),
    section("Прочие изменённые файлы", otherFiles.map((f) => `- [${f.status}] ${f.path}`).join("\n")),
    section(
      "Обсуждение",
      pr.discussions
        .slice(-15)
        .map((d) => `### ${d.author}${d.file ? ` (${d.file})` : ""}${d.resolved === false ? " [не решено]" : ""}\n${d.body}`)
        .join("\n\n"),
    ),
  ].join("\n");
}

// ───────────────────────────── tools ─────────────────────────────

export const specGetPr: ToolDefinition<{ pr: string | number }> = defineTool({
  name: "spec_get_pr",
  title: "Read the analytics spec PR",
  description:
    "Прочитать pull request в репозитории аналитики (SA specification). Возвращает заголовок, описание, " +
    "ветки, упомянутые тикеты, список изменённых файлов спецификации и обсуждение. " +
    "Это главный источник требований: мы работаем spec-driven, и именно PR аналитики описывает, что нужно сделать. " +
    "Тела файлов читай отдельно через spec_read_file.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: z.object({
    pr: z.union([z.string(), z.number()]).describe("Id pull request: 456, #456 или полная ссылка на него."),
  }),
  async handler(input, ctx) {
    const n = parsePrNumber(String(input.pr));
    if (n === null) return failure(`"${input.pr}" не похоже на id pull request. Ожидается число, #123 или ссылка.`);

    const cfg = ctx.config;
    if (cfg.spec.provider !== "mock") {
      if (!cfg.spec.baseUrl) return failure("SPEC_BASE_URL не настроен для сервера инструментов.");
      if (!cfg.spec.token) return failure("SPEC_TOKEN не настроен для сервера инструментов.");
      if (!cfg.spec.projectId) return failure("SPEC_PROJECT_ID (репозиторий аналитики) не настроен.");
    }

    let pr: SpecPullRequest;
    try {
      pr = await fetchPr(cfg, n);
    } catch (err) {
      return failure(`Не удалось получить PR ${n} из репозитория аналитики: ${err instanceof Error ? err.message : String(err)}`);
    }

    ctx.logger.info("spec pr fetched", { number: pr.number, files: pr.files.length, tickets: pr.tickets });
    return text(render(pr, cfg), { pr: pr as unknown as Record<string, unknown> });
  },
});

export const specReadFile: ToolDefinition<{ pr: string | number; path: string; mode?: "content" | "diff" }> = defineTool({
  name: "spec_read_file",
  title: "Read a file from the spec PR",
  description:
    "Прочитать файл спецификации в том виде, в котором он лежит в ветке PR аналитики (mode=content, по умолчанию), " +
    "или только его изменения в этом PR (mode=diff). " +
    "Требования берутся из полного текста файла; diff показывает, что именно аналитик поменял в этой итерации.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: z.object({
    pr: z.union([z.string(), z.number()]).describe("Id pull request в репозитории аналитики."),
    path: z.string().describe("Путь к файлу ровно как он указан в списке файлов spec_get_pr."),
    mode: z.enum(["content", "diff"]).optional().describe("content — весь файл из ветки PR (по умолчанию); diff — только изменения."),
  }),
  async handler(input, ctx) {
    const n = parsePrNumber(String(input.pr));
    if (n === null) return failure(`"${input.pr}" не похоже на id pull request.`);

    const cfg = ctx.config;
    let pr: SpecPullRequest;
    try {
      pr = await fetchPr(cfg, n);
    } catch (err) {
      return failure(`Не удалось получить PR ${n}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const known = pr.files.map((f) => f.path);
    const target = known.includes(input.path) ? input.path : known.find((p) => p.endsWith(input.path));
    if (!target) {
      return failure(`В PR ${n} нет файла "${input.path}". Изменённые файлы:\n${known.map((p) => `  ${p}`).join("\n")}`);
    }

    const mode = input.mode ?? "content";
    let body: string;
    try {
      body = mode === "diff" ? await readFileDiff(cfg, pr, target) : await readFileContent(cfg, pr, target);
    } catch (err) {
      return failure(`Не удалось прочитать "${target}" (${mode}): ${err instanceof Error ? err.message : String(err)}`);
    }

    let truncated = false;
    if (Buffer.byteLength(body, "utf8") > cfg.spec.maxFileBytes) {
      body = body.slice(0, cfg.spec.maxFileBytes);
      truncated = true;
    }

    return text(
      `=== ${target} (${mode}, PR ${n}, ветка ${pr.sourceBranch}) ===\n${body}` +
        (truncated ? `\n\n[обрезано на ${cfg.spec.maxFileBytes} байт — подними SPEC_MAX_FILE_BYTES при необходимости]` : ""),
      { pr: n, path: target, mode, truncated },
    );
  },
});

/** При SPEC_PROVIDER=external спецификацию читает внешний MCP-сервер Bitbucket. */
export function specTools(cfg: Config): ToolDefinition<any>[] {
  return cfg.spec.provider === "external" ? [] : [specGetPr, specReadFile];
}
