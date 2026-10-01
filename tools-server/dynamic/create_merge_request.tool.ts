import { defineTool, failure, text, z } from "./_sdk.js";

/**
 * Worked example of an agent-authored tool.
 *
 * It exists so the very first ticket can reach a merge request without the
 * agent having to invent this itself — and so there is a concrete reference
 * for what `tool_create` is expected to produce. Rewrite it freely.
 */
export default defineTool({
  name: "create_merge_request",
  title: "Open merge request",
  description:
    "Открыть merge/pull request для уже запушенной ветки сервиса. Сначала push, потом этот вызов. " +
    "Проект определяется по имени сервиса и группе из SERVICES_GROUP; хост и токен — из окружения сервера. " +
    "Задача, затрагивающая несколько сервисов, даёт несколько MR — по одному на сервис.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: z.object({
    service: z.string().describe("Имя сервиса, как его вернул service_checkout, например payment-be."),
    sourceBranch: z.string().describe("Запушенная ветка, например feature/BACK-1234-add-retry."),
    title: z.string().describe("Заголовок MR по формату из базы знаний, обычно '<TICKET>: <что сделано>'."),
    description: z.string().describe("Описание в markdown: ссылка на PR аналитики и тикет, таблица требований, применённые конвенции, расхождения."),
    targetBranch: z.string().optional().describe("По умолчанию SERVICES_DEFAULT_BRANCH."),
    draft: z.boolean().optional().describe("Создавать черновиком (по умолчанию true — снимает draft человек)."),
    removeSourceBranch: z.boolean().optional().describe("Удалять ветку после мержа (по умолчанию true).")
  }),
  async handler(input, ctx) {
    const svc = ctx.config.services;
    const vcs = ctx.config.vcs;
    const target = input.targetBranch ?? svc.defaultBranch;
    const draft = input.draft ?? true;

    const token = svc.token || vcs.token;
    const baseUrl = svc.apiUrl || vcs.baseUrl;
    // Проект собирается из группы и имени сервиса; VCS_PROJECT_ID — запасной вариант.
    const project = svc.group ? `${svc.group}/${input.service}` : vcs.projectId;

    if (!token) return failure("Не задан SERVICES_TOKEN (или VCS_TOKEN).");
    if (!baseUrl) return failure("Не задан SERVICES_API_URL (или VCS_BASE_URL).");
    if (!project) return failure("Не удалось определить проект: задайте SERVICES_GROUP или VCS_PROJECT_ID.");

    const provider = svc.provider || vcs.provider;

    if (provider === "gitlab") {
      const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(project)}/merge_requests`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_branch: input.sourceBranch,
          target_branch: target,
          title: draft ? `Draft: ${input.title}` : input.title,
          description: input.description,
          remove_source_branch: input.removeSourceBranch ?? true,
          squash: true,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      if (!response.ok) return failure(`GitLab responded ${response.status}: ${body.slice(0, 800)}`);
      const mr = JSON.parse(body) as { web_url: string; iid: number };
      ctx.logger.info("merge request created", { service: input.service, iid: mr.iid, url: mr.web_url });
      return text(`${input.service}: merge request !${mr.iid} создан — ${mr.web_url}`, {
        service: input.service, url: mr.web_url, iid: mr.iid,
      });
    }

    if (provider === "github") {
      const [owner, repo] = project.split("/");
      if (!owner || !repo) return failure(`Для GitHub нужен проект вида "owner/repo", получено "${project}".`);
      const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          head: input.sourceBranch,
          base: target,
          title: input.title,
          body: input.description,
          draft,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      if (!response.ok) return failure(`GitHub responded ${response.status}: ${body.slice(0, 800)}`);
      const pr = JSON.parse(body) as { html_url: string; number: number };
      return text(`${input.service}: pull request #${pr.number} создан — ${pr.html_url}`, {
        service: input.service, url: pr.html_url, number: pr.number,
      });
    }

    return failure(`Провайдер "${provider}" в этом инструменте не реализован. Доработай его через tool_create.`);
  },
});
