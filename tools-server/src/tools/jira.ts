import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Config } from "../lib/config.js";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

const TICKET_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

function authHeader(cfg: Config): Record<string, string> {
  if (!cfg.jira.token) return {};
  if (cfg.jira.auth === "basic") {
    const pair = Buffer.from(`${cfg.jira.email}:${cfg.jira.token}`).toString("base64");
    return { Authorization: `Basic ${pair}` };
  }
  return { Authorization: `Bearer ${cfg.jira.token}` };
}

/** Jira Cloud returns descriptions as ADF; Server/DC returns plain text. Flatten both. */
function renderAdf(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderAdf).join("");
  switch (node.type) {
    case "text": return String(node.text ?? "");
    case "hardBreak": return "\n";
    case "paragraph": return renderAdf(node.content) + "\n\n";
    case "heading": return `${"#".repeat(node.attrs?.level ?? 2)} ${renderAdf(node.content)}\n\n`;
    case "bulletList":
    case "orderedList": return renderAdf(node.content);
    case "listItem": return `- ${renderAdf(node.content).trim()}\n`;
    case "codeBlock": return "```\n" + renderAdf(node.content) + "\n```\n\n";
    case "inlineCard": return String(node.attrs?.url ?? "");
    default: return renderAdf(node.content);
  }
}

interface NormalizedIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  reporter: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  parent: string | null;
  epic: string | null;
  description: string;
  acceptanceCriteria: string;
  comments: { author: string; created: string; body: string }[];
  links: { type: string; key: string; summary: string }[];
  url: string;
}

function normalize(raw: any, baseUrl: string): NormalizedIssue {
  const f = raw.fields ?? {};
  const ac =
    f.customfield_10100 ?? f.customfield_10200 ?? f.acceptanceCriteria ?? null;
  return {
    key: raw.key,
    summary: f.summary ?? "",
    type: f.issuetype?.name ?? "",
    status: f.status?.name ?? "",
    priority: f.priority?.name ?? "",
    assignee: f.assignee?.displayName ?? "unassigned",
    reporter: f.reporter?.displayName ?? "",
    labels: f.labels ?? [],
    components: (f.components ?? []).map((c: any) => c.name),
    fixVersions: (f.fixVersions ?? []).map((v: any) => v.name),
    parent: f.parent?.key ?? null,
    epic: f.epic?.key ?? f.customfield_10014 ?? null,
    description: renderAdf(f.description).trim(),
    acceptanceCriteria: renderAdf(ac).trim(),
    comments: (f.comment?.comments ?? []).map((c: any) => ({
      author: c.author?.displayName ?? "",
      created: c.created ?? "",
      body: renderAdf(c.body).trim(),
    })),
    links: (f.issuelinks ?? []).flatMap((l: any) => {
      const other = l.outwardIssue ?? l.inwardIssue;
      if (!other) return [];
      return [{
        type: l.type?.outward ?? l.type?.inward ?? "related",
        key: other.key,
        summary: other.fields?.summary ?? "",
      }];
    }),
    url: baseUrl ? `${baseUrl}/browse/${raw.key}` : "",
  };
}

function render(issue: NormalizedIssue): string {
  const section = (title: string, body: string) => (body.trim() ? `\n## ${title}\n${body.trim()}\n` : "");
  const meta = [
    `type: ${issue.type}`,
    `status: ${issue.status}`,
    `priority: ${issue.priority}`,
    `assignee: ${issue.assignee}`,
    issue.components.length ? `components: ${issue.components.join(", ")}` : "",
    issue.labels.length ? `labels: ${issue.labels.join(", ")}` : "",
    issue.fixVersions.length ? `fixVersions: ${issue.fixVersions.join(", ")}` : "",
    issue.parent ? `parent: ${issue.parent}` : "",
    issue.epic ? `epic: ${issue.epic}` : "",
    issue.url ? `url: ${issue.url}` : "",
  ].filter(Boolean).join("\n");

  return [
    `# ${issue.key}: ${issue.summary}`,
    "",
    meta,
    section("Description", issue.description || "_(empty)_"),
    section("Acceptance criteria", issue.acceptanceCriteria),
    section(
      "Linked issues",
      issue.links.map((l) => `- ${l.type} ${l.key}: ${l.summary}`).join("\n"),
    ),
    section(
      "Comments",
      issue.comments.slice(-10).map((c) => `### ${c.author} (${c.created})\n${c.body}`).join("\n\n"),
    ),
  ].join("\n");
}

export const jiraGetIssue: ToolDefinition<{ ticket: string; raw?: boolean }> = defineTool({
  name: "jira_get_issue",
  title: "Read Jira issue",
  description:
    "Fetch a Jira issue by key (e.g. BACK-1234) and return summary, description, acceptance criteria, " +
    "labels, components, links and recent comments. This is the agent's single entry point: the ticket key is the only input the agent receives.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  inputSchema: z.object({
    ticket: z.string().describe("Jira issue key, e.g. BACK-1234."),
    raw: z.boolean().optional().describe("Return the raw Jira JSON instead of the rendered summary."),
  }),
  async handler(input, ctx) {
    const cfg = ctx.config;
    const key = input.ticket.trim().toUpperCase();
    if (!TICKET_RE.test(key)) {
      return failure(`"${input.ticket}" is not a Jira issue key. Expected something like BACK-1234.`);
    }

    if (cfg.jira.provider === "external") {
      return failure(
        "jira_get_issue is disabled: JIRA_PROVIDER=external. Use the external Jira MCP connector's tools instead.",
      );
    }

    if (cfg.jira.provider === "mock") {
      const file = path.join(cfg.jira.mockDir, `${key}.json`);
      try {
        const raw = JSON.parse(await fs.readFile(file, "utf8"));
        const issue = normalize(raw, cfg.jira.baseUrl);
        return text(input.raw ? JSON.stringify(raw, null, 2) : render(issue), { issue: issue as unknown as Record<string, unknown> });
      } catch (err) {
        return failure(`No mock fixture for ${key} at ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!cfg.jira.baseUrl) return failure("JIRA_BASE_URL is not configured for the tools server.");
    if (!cfg.jira.token) return failure("JIRA_TOKEN is not configured for the tools server.");

    const url = `${cfg.jira.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}` +
      `?expand=renderedFields&fields=summary,description,issuetype,status,priority,assignee,reporter,labels,components,fixVersions,parent,issuelinks,comment,customfield_10100,customfield_10200,customfield_10014`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json", ...authHeader(cfg) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return failure(`Jira request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.status === 404) return failure(`Jira issue ${key} not found (or not visible to this token).`);
    if (!response.ok) return failure(`Jira responded ${response.status} ${response.statusText} for ${key}.`);

    const raw = await response.json();
    const issue = normalize(raw, cfg.jira.baseUrl);
    ctx.logger.info("jira issue fetched", { key, status: issue.status, type: issue.type });

    return text(input.raw ? JSON.stringify(raw, null, 2) : render(issue), { issue: issue as unknown as Record<string, unknown> });
  },
});

/** Only exposed when this server owns the Jira integration. */
export function jiraTools(cfg: Config): ToolDefinition<any>[] {
  return cfg.jira.provider === "external" ? [] : [jiraGetIssue];
}
