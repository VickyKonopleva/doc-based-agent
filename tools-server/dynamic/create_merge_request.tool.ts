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
    "Open a merge/pull request for an already-pushed branch. Push first (git push -u origin <branch>), then call this. " +
    "Provider, host, token and project id come from the tool server's environment (VCS_*).",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: z.object({
    sourceBranch: z.string().describe("Branch that was pushed, e.g. feature/BACK-1234-add-retry."),
    title: z.string().describe("MR title. Follow 30-conventions/branching-and-commits.md — usually '<TICKET>: <summary>'."),
    description: z.string().describe("MR body in markdown: what changed, why, which ai-docs conventions applied, how it was tested."),
    targetBranch: z.string().optional().describe("Defaults to VCS_TARGET_BRANCH."),
    draft: z.boolean().optional().describe("Open as draft (default true — a human reviews before it is marked ready)."),
    removeSourceBranch: z.boolean().optional().describe("Delete the source branch on merge (default true)."),
  }),
  async handler(input, ctx) {
    const vcs = ctx.config.vcs;
    const target = input.targetBranch ?? vcs.defaultTargetBranch;
    const draft = input.draft ?? true;

    if (!vcs.token) return failure("VCS_TOKEN is not set for the tool server.");
    if (!vcs.projectId) return failure("VCS_PROJECT_ID is not set for the tool server.");
    if (!vcs.baseUrl) return failure("VCS_BASE_URL is not set for the tool server.");

    if (vcs.provider === "gitlab") {
      const url = `${vcs.baseUrl}/api/v4/projects/${encodeURIComponent(vcs.projectId)}/merge_requests`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": vcs.token, "Content-Type": "application/json" },
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
      ctx.logger.info("merge request created", { iid: mr.iid, url: mr.web_url });
      return text(`Merge request !${mr.iid} created: ${mr.web_url}`, { url: mr.web_url, iid: mr.iid });
    }

    if (vcs.provider === "github") {
      const [owner, repo] = vcs.projectId.split("/");
      if (!owner || !repo) return failure(`VCS_PROJECT_ID must be "owner/repo" for GitHub, got "${vcs.projectId}".`);
      const response = await fetch(`${vcs.baseUrl}/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vcs.token}`,
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
      return text(`Pull request #${pr.number} created: ${pr.html_url}`, { url: pr.html_url, number: pr.number });
    }

    return failure(`VCS provider "${vcs.provider}" is not implemented in this tool. Extend it with tool_create.`);
  },
});
