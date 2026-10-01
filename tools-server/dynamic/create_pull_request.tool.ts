import { defineTool, failure, text, z } from "./_sdk.js";

/**
 * Рабочий пример инструмента, написанного агентом.
 *
 * Он лежит здесь, чтобы первая же задача дошла до pull request, а агенту не
 * пришлось изобретать это самому, и чтобы был живой образец того, что
 * ожидается от `tool_create`. Переписывать его можно свободно.
 */
export default defineTool({
  name: "create_pull_request",
  title: "Открыть pull request",
  description:
    "Открыть pull request в репозитории сервиса для уже запушенной ветки. Сначала push, потом этот вызов. " +
    "Репозиторий определяется по имени сервиса и проекту из SERVICES_GROUP; хост и токен — из окружения сервера. " +
    "Задача, затрагивающая несколько сервисов, даёт несколько PR — по одному на сервис.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: z.object({
    service: z.string().describe("Имя сервиса, как его вернул service_checkout, например payment-be."),
    sourceBranch: z.string().describe("Запушенная ветка, например feature/BACK-1234-add-retry."),
    title: z.string().describe("Заголовок PR по формату из базы знаний, обычно '<TICKET>: <что сделано>'."),
    description: z.string().describe("Описание в markdown: ссылка на PR аналитики и тикет, таблица требований, применённые конвенции, расхождения."),
    targetBranch: z.string().optional().describe("По умолчанию SERVICES_DEFAULT_BRANCH."),
    draft: z.boolean().optional().describe("Пометить как черновик (по умолчанию true). В Bitbucket Server черновиков нет — к заголовку добавится 'WIP:'."),
    reviewers: z.array(z.string()).optional().describe("Логины ревьюеров. По умолчанию никого: ревьюеров назначает человек."),
  }),
  async handler(input, ctx) {
    const svc = ctx.config.services;
    const vcs = ctx.config.vcs;
    const target = input.targetBranch ?? svc.defaultBranch;
    const draft = input.draft ?? true;

    const token = svc.token || vcs.token;
    const baseUrl = svc.apiUrl || vcs.baseUrl;
    const provider = svc.provider || vcs.provider;
    const repo = svc.group ? `${svc.group}/${input.service}` : vcs.projectId;

    if (!baseUrl) return failure("Не задан SERVICES_API_URL (или VCS_BASE_URL).");
    if (!repo) return failure("Не удалось определить репозиторий: задайте SERVICES_GROUP или VCS_PROJECT_ID.");

    if (provider === "bitbucket") {
      const [project, slug] = repo.split("/");
      if (!project || !slug) return failure(`Для Bitbucket нужен репозиторий вида "КЛЮЧПРОЕКТА/slug", получено "${repo}".`);

      const url =
        `${baseUrl}/rest/api/1.0/projects/${encodeURIComponent(project)}` +
        `/repos/${encodeURIComponent(slug)}/pull-requests`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // В Bitbucket Server нет черновиков: признак незавершённости — префикс заголовка.
          title: draft ? `WIP: ${input.title}` : input.title,
          description: input.description,
          state: "OPEN",
          open: true,
          closed: false,
          fromRef: { id: `refs/heads/${input.sourceBranch}`, repository: { slug, project: { key: project } } },
          toRef: { id: `refs/heads/${target}`, repository: { slug, project: { key: project } } },
          locked: false,
          reviewers: (input.reviewers ?? []).map((name) => ({ user: { name } })),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const body = await response.text();
      if (!response.ok) return failure(`Bitbucket ответил ${response.status}: ${body.slice(0, 800)}`);
      const pr = JSON.parse(body) as { id: number; links?: { self?: { href: string }[] } };
      const link = pr.links?.self?.[0]?.href ?? `${baseUrl}/projects/${project}/repos/${slug}/pull-requests/${pr.id}`;
      ctx.logger.info("pull request created", { service: input.service, id: pr.id, url: link });
      return text(`${input.service}: pull request #${pr.id} создан — ${link}`, {
        service: input.service, url: link, id: pr.id,
      });
    }

    if (provider === "gitlab") {
      if (!token) return failure("Не задан SERVICES_TOKEN (или VCS_TOKEN).");
      const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(repo)}/merge_requests`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_branch: input.sourceBranch,
          target_branch: target,
          title: draft ? `Draft: ${input.title}` : input.title,
          description: input.description,
          remove_source_branch: true,
          squash: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      if (!response.ok) return failure(`GitLab ответил ${response.status}: ${body.slice(0, 800)}`);
      const mr = JSON.parse(body) as { web_url: string; iid: number };
      return text(`${input.service}: pull request !${mr.iid} создан — ${mr.web_url}`, {
        service: input.service, url: mr.web_url, id: mr.iid,
      });
    }

    if (provider === "github") {
      if (!token) return failure("Не задан SERVICES_TOKEN (или VCS_TOKEN).");
      const [owner, name] = repo.split("/");
      if (!owner || !name) return failure(`Для GitHub нужен репозиторий вида "owner/repo", получено "${repo}".`);
      const response = await fetch(`${baseUrl}/repos/${owner}/${name}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ head: input.sourceBranch, base: target, title: input.title, body: input.description, draft }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      if (!response.ok) return failure(`GitHub ответил ${response.status}: ${body.slice(0, 800)}`);
      const pr = JSON.parse(body) as { html_url: string; number: number };
      return text(`${input.service}: pull request #${pr.number} создан — ${pr.html_url}`, {
        service: input.service, url: pr.html_url, id: pr.number,
      });
    }

    return failure(`Провайдер "${provider}" в этом инструменте не реализован. Доработай его через tool_create.`);
  },
});
