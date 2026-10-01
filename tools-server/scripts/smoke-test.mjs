/**
 * End-to-end smoke test: spawns the server over stdio exactly like GigaCode
 * does, lists the tools, exercises the read paths and proves that a tool the
 * agent writes at run time becomes callable without a restart.
 *
 *   npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..");

// Настоящий bare-репозиторий на диске: service_checkout клонирует его по-настоящему,
// так что проверяется и сборка URL из префикса, и git-часть.
const SERVICES_ROOT = path.join(SERVER_DIR, ".cache", "services-test");
const WORKSPACES = path.join(SERVER_DIR, ".cache", "workspaces-test");
function seedServiceRepo(name) {
  const bare = path.join(SERVICES_ROOT, `${name}.git`);
  const seed = path.join(SERVICES_ROOT, `${name}-seed`);
  const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "pipe" });
  // Только синхронное удаление: промис от fs.rm разрешился бы уже после git init
  // и снёс бы только что созданный репозиторий.
  execFileSync("rm", ["-rf", SERVICES_ROOT, WORKSPACES]);
  execFileSync("mkdir", ["-p", SERVICES_ROOT]);
  git(["init", "--bare", "-b", "master", bare]);
  git(["clone", bare, seed]);
  execFileSync("sh", ["-c", `echo 'service ${name}' > "${seed}/README.md"`]);
  git(["add", "-A"], seed);
  git(["-c", "user.email=smoke@test", "-c", "user.name=Smoke", "commit", "-m", "init"], seed);
  git(["push", "origin", "master"], seed);
  execFileSync("rm", ["-rf", seed]);
}
seedServiceRepo("payment-be");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const textOf = (res) => res.content.map((c) => c.text ?? "").join("\n");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(SERVER_DIR, "dist", "index.js")],
  env: {
    ...process.env,
    AI_DOCS_PATH: path.join(SERVER_DIR, "fixtures", "ai-docs"),
    TOOLS_DYNAMIC_DIR: path.join(SERVER_DIR, "dynamic"),
    JIRA_PROVIDER: "mock",
    JIRA_MOCK_DIR: path.join(SERVER_DIR, "fixtures", "jira"),
    SPEC_PROVIDER: "mock",
    SPEC_MOCK_DIR: path.join(SERVER_DIR, "fixtures", "spec"),
    GIGACODE_DIR: path.join(SERVER_DIR, ".cache", "gigacode-test"),
    SERVICES_PROVIDER: "mock",
    SERVICES_MOCK_DIR: path.join(SERVER_DIR, "fixtures", "services"),
    SERVICES_GIT_BASE: SERVICES_ROOT + "/",
    SERVICES_GROUP: "backend",
    SERVICES_SUFFIX: "-be",
    SERVICES_DEFAULT_BRANCH: "master",
    WORKSPACES_DIR: WORKSPACES,
    LOG_LEVEL: "warn",
  },
  stderr: "inherit",
});

const client = new Client({ name: "smoke-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

console.log("\n== tools/list ==");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log(`  ${names.join(", ")}`);
for (const expected of ["docs_read", "docs_search", "jira_get_issue", "spec_get_pr", "spec_read_file", "service_list", "service_checkout", "skill_create", "tool_create", "tool_list", "tool_template", "create_merge_request"]) {
  check(names.includes(expected), `exposes ${expected}`);
}
check(
  tools.every((t) => t.inputSchema && t.inputSchema.type === "object"),
  "every tool has an object input schema",
);

console.log("\n== ai-docs ==");
const catalogue = await client.callTool({ name: "docs_read", arguments: {} });
const catalogueText = textOf(catalogue);
check(catalogueText.includes("Карта базы знаний"), "docs_read() returns the index");
check(/Catalogue \(\d+ documents\)/.test(catalogueText), "docs_read() returns the catalogue");

const search = await client.callTool({ name: "docs_search", arguments: { query: "идемпотентность kafka" } });
check(textOf(search).includes("arch-integration") || textOf(search).includes("integration-patterns.md"), "docs_search finds the integration doc");

const byId = await client.callTool({ name: "docs_read", arguments: { path: "conv-rest-api" } });
check(textOf(byId).includes("Конвенции REST API"), "docs_read resolves a frontmatter id");

const section = await client.callTool({ name: "docs_read", arguments: { path: "conv-rest-api", section: "Пагинация" } });
check(textOf(section).includes("nextCursor"), "docs_read returns a single section");
check(!textOf(section).includes("## URL"), "section slice excludes other sections");

const missing = await client.callTool({ name: "docs_read", arguments: { path: "no-such-doc" } });
check(missing.isError === true, "docs_read reports a missing document as an error");

console.log("\n== jira (mock) ==");
const issue = await client.callTool({ name: "jira_get_issue", arguments: { ticket: "back-1234" } });
const issueText = textOf(issue);
check(issueText.includes("BACK-1234"), "jira_get_issue normalises the key to upper case");
check(issueText.includes("Acceptance criteria"), "acceptance criteria are rendered");
check(issueText.includes("payment-service"), "component reaches the agent");

const badKey = await client.callTool({ name: "jira_get_issue", arguments: { ticket: "nonsense" } });
check(badKey.isError === true, "jira_get_issue rejects a malformed key");

console.log("\n== spec PR (mock) ==");
const specPr = await client.callTool({ name: "spec_get_pr", arguments: { pr: "!456" } });
const specText = textOf(specPr);
check(specText.includes("Spec PR !456"), "spec_get_pr accepts !456 and normalises it");
check(specText.includes("BACK-1234"), "the ticket mentioned in the spec PR is surfaced");
check(specText.includes("callback-retry.md"), "spec files are listed");
check(specText.includes("не решено"), "an unresolved discussion thread is flagged");
check(!specText.includes("| R1 |"), "spec_get_pr does not inline file bodies");

const specUrl = await client.callTool({
  name: "spec_get_pr",
  arguments: { pr: "https://git.company.ru/analytics/sa-specifications/-/merge_requests/456" },
});
check(textOf(specUrl).includes("Spec PR !456"), "spec_get_pr accepts a full MR url");

const specFile = await client.callTool({
  name: "spec_read_file",
  arguments: { pr: 456, path: "payments/payment-service/callback-retry.md" },
});
const specFileText = textOf(specFile);
check(specFileText.includes("| R1 |"), "spec_read_file returns the full requirements table");
check(specFileText.includes("CALLBACK_RETRIES_EXHAUSTED"), "requirement details reach the agent");

const specDiff = await client.callTool({
  name: "spec_read_file",
  arguments: { pr: 456, path: "events/payment-failed-v1.yaml", mode: "diff" },
});
check(textOf(specDiff).includes("+      - CALLBACK_RETRIES_EXHAUSTED"), "spec_read_file resolves a path suffix and returns a diff");

const specMissing = await client.callTool({ name: "spec_read_file", arguments: { pr: 456, path: "nope.md" } });
check(specMissing.isError === true, "spec_read_file reports an unknown file as an error");
check(textOf(specMissing).includes("callback-retry.md"), "the error lists the files that are in the PR");

const specBadPr = await client.callTool({ name: "spec_get_pr", arguments: { pr: "abc" } });
check(specBadPr.isError === true, "spec_get_pr rejects a malformed PR reference");

console.log("\n== services ==");
const svcAll = await client.callTool({ name: "service_list", arguments: {} });
const svcAllText = textOf(svcAll);
check(svcAllText.includes("payment-be"), "service_list returns backend services");
check(svcAllText.includes("Прочие репозитории"), "repos without the -be suffix are listed separately");
check(svcAllText.indexOf("payment-be") < svcAllText.indexOf("legacy-billing"), "backend services come first");

const svcFiltered = await client.callTool({ name: "service_list", arguments: { query: "order" } });
check(textOf(svcFiltered).includes("order-be") && !textOf(svcFiltered).includes("catalog-be"), "service_list filters by query");

const checkout = await client.callTool({ name: "service_checkout", arguments: { service: "payment" } });
const checkoutText = textOf(checkout);
check(checkout.isError !== true, "service_checkout clones a service named without the suffix", checkoutText.split("\n")[0]);
check(checkoutText.includes("payment-be"), "the suffix is appended when building the repository address");
check(checkoutText.includes("backend/payment-be"), "the API project path is reported for the MR step");
check(
  await fs.access(path.join(WORKSPACES, "payment-be", "README.md")).then(() => true, () => false),
  "the working copy really lands on disk",
);

const withBranch = await client.callTool({
  name: "service_checkout",
  arguments: { service: "payment-be", branch: "feature/BACK-1234-retry" },
});
check(textOf(withBranch).includes("feature/BACK-1234-retry"), "service_checkout creates the working branch");
check(textOf(withBranch).includes("готов"), "a second call on an existing clone succeeds instead of failing");

const unknown = await client.callTool({ name: "service_checkout", arguments: { service: "no-such" } });
check(unknown.isError === true, "service_checkout reports an unknown service as an error");
check(textOf(unknown).includes("service_list"), "the error points at service_list to check the name");

console.log("\n== self-authored skills ==");
const skillTemplate = await client.callTool({ name: "skill_create", arguments: {} });
check(textOf(skillTemplate).includes("name: <skill-name>"), "skill_create without arguments returns the template");
check(textOf(skillTemplate).includes("Когда НЕ писать"), "the template states when a skill is the wrong answer");

const brokenYaml = await client.callTool({
  name: "skill_create",
  arguments: {
    name: "smoke-skill",
    source: "---\nname: smoke-skill\ndescription: Разбор: двоеточие ломает YAML\n---\n\nТело.\n",
  },
});
check(brokenYaml.isError === true, "skill_create rejects frontmatter with an unquoted colon");
check(textOf(brokenYaml).includes("двоеточие"), "the rejection explains the actual cause");

const nameMismatch = await client.callTool({
  name: "skill_create",
  arguments: { name: "smoke-skill", source: "---\nname: other\ndescription: x\n---\n\nТело.\n" },
});
check(nameMismatch.isError === true, "skill_create rejects a name that disagrees with the frontmatter");

const goodSkill = await client.callTool({
  name: "skill_create",
  arguments: {
    name: "smoke-skill",
    overwrite: true,
    source: "---\nname: smoke-skill\ndescription: Временный скил, созданный smoke-тестом\npriority: 5\n---\n\n# Smoke\n\n## Шаги\n\n1. Ничего.\n",
  },
});
check(goodSkill.isError !== true, "skill_create accepts a valid skill", textOf(goodSkill).slice(0, 80));
const skillFile = path.join(SERVER_DIR, ".cache", "gigacode-test", "skills", "smoke-skill", "SKILL.md");
check(await fs.access(skillFile).then(() => true, () => false), "the skill file lands in .gigacode/skills/<name>/SKILL.md");
check(textOf(goodSkill).includes("следующей сессии"), "the agent is told skills are not hot-reloaded");

const listed = await client.callTool({ name: "skill_create", arguments: {} });
check(textOf(listed).includes("smoke-skill"), "an existing skill shows up in the template listing");

await fs.rm(path.join(SERVER_DIR, ".cache", "gigacode-test"), { recursive: true, force: true });
await fs.rm(SERVICES_ROOT, { recursive: true, force: true });
await fs.rm(WORKSPACES, { recursive: true, force: true });

console.log("\n== self-extension ==");
const created = await client.callTool({
  name: "tool_create",
  arguments: {
    name: "smoke_echo",
    overwrite: true,
    source: `import { defineTool, text, z } from "./_sdk.js";

export default defineTool({
  name: "smoke_echo",
  description: "Temporary tool written by the smoke test.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({ value: z.string().describe("Anything.") }),
  async handler(input) {
    return text(\`echo:\${input.value}\`);
  },
});
`,
  },
});
check(created.isError !== true, "tool_create accepts a valid tool", textOf(created).slice(0, 160));

const afterCreate = (await client.listTools()).tools.map((t) => t.name);
check(afterCreate.includes("smoke_echo"), "the new tool appears in tools/list without a restart");

const echoed = await client.callTool({ name: "smoke_echo", arguments: { value: "42" } });
check(textOf(echoed) === "echo:42", "the new tool is callable immediately", textOf(echoed));

const broken = await client.callTool({
  name: "tool_create",
  arguments: { name: "smoke_broken", source: "this is not valid typescript at all ((( export default" },
});
check(broken.isError === true, "tool_create rejects source that does not compile");
check(
  !(await client.listTools()).tools.some((t) => t.name === "smoke_broken"),
  "a rejected tool is not registered",
);
check(
  !(await fs.readdir(path.join(SERVER_DIR, "dynamic"))).includes("smoke_broken.tool.ts"),
  "a rejected tool leaves no file behind",
);

const badArgs = await client.callTool({ name: "smoke_echo", arguments: { wrong: 1 } });
check(badArgs.isError === true, "schema validation rejects bad arguments");

const deleted = await client.callTool({ name: "tool_delete", arguments: { name: "smoke_echo" } });
check(deleted.isError !== true, "tool_delete removes the temporary tool");
check(!(await client.listTools()).tools.some((t) => t.name === "smoke_echo"), "deleted tool disappears from tools/list");

await client.close();

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
