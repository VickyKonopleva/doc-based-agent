/**
 * Сквозная проверка: сервер поднимается по stdio ровно так же, как это делает
 * GigaCode, перечисляются инструменты, прогоняются пути чтения и доказывается,
 * что инструмент, написанный агентом на лету, становится вызываемым без
 * рестарта.
 *
 *   npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..");

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
for (const expected of ["docs_read", "docs_search", "jira_get_issue", "spec_get_pr", "spec_read_file", "skill_create", "tool_create", "tool_list", "tool_template"]) {
  check(names.includes(expected), `инструмент ${expected} объявлен`);
}
check(
  tools.every((t) => t.inputSchema && t.inputSchema.type === "object"),
  "у каждого инструмента объектная схема аргументов",
);

console.log("\n== база знаний ==");
const catalogue = await client.callTool({ name: "docs_read", arguments: {} });
const catalogueText = textOf(catalogue);
check(catalogueText.includes("Карта базы знаний"), "docs_read() отдаёт INDEX базы знаний");
check(/Каталог \(\d+ документов\)/.test(catalogueText), "docs_read() отдаёт каталог документов");

const search = await client.callTool({ name: "docs_search", arguments: { query: "идемпотентность kafka" } });
check(textOf(search).includes("arch-integration") || textOf(search).includes("integration-patterns.md"), "docs_search находит документ про интеграции");

const byId = await client.callTool({ name: "docs_read", arguments: { path: "conv-rest-api" } });
check(textOf(byId).includes("Конвенции REST API"), "docs_read находит документ по id из frontmatter");

const section = await client.callTool({ name: "docs_read", arguments: { path: "conv-rest-api", section: "Пагинация" } });
check(textOf(section).includes("nextCursor"), "docs_read отдаёт одну секцию");
check(!textOf(section).includes("## URL"), "в секцию не попадают соседние разделы");

const missing = await client.callTool({ name: "docs_read", arguments: { path: "no-such-doc" } });
check(missing.isError === true, "docs_read сообщает об отсутствии документа ошибкой");

console.log("\n== тикет Jira (фикстура) ==");
const issue = await client.callTool({ name: "jira_get_issue", arguments: { ticket: "back-1234" } });
const issueText = textOf(issue);
check(issueText.includes("BACK-1234"), "jira_get_issue приводит ключ тикета к верхнему регистру");
check(issueText.includes("Критерии приёмки"), "критерии приёмки попадают в выдачу");
check(issueText.includes("payment-service"), "компонент из тикета доходит до агента");

const badKey = await client.callTool({ name: "jira_get_issue", arguments: { ticket: "nonsense" } });
check(badKey.isError === true, "jira_get_issue отвергает неверный ключ тикета");

console.log("\n== PR аналитики (фикстура) ==");
const specPr = await client.callTool({ name: "spec_get_pr", arguments: { pr: "#456" } });
const specText = textOf(specPr);
check(specText.includes("PR аналитики #456"), "spec_get_pr принимает #456 и нормализует id");
check(specText.includes("BACK-1234"), "тикет, упомянутый в PR аналитики, виден агенту");
check(specText.includes("callback-retry.md"), "файлы спецификации перечислены");
check(specText.includes("не решено"), "нерешённый тред обсуждения помечен");
check(!specText.includes("| R1 |"), "spec_get_pr не вставляет тела файлов в выдачу");

const specUrl = await client.callTool({
  name: "spec_get_pr",
  arguments: { pr: "https://bitbucket.company.ru/projects/SA/repos/sa-specifications/pull-requests/456" },
});
check(textOf(specUrl).includes("PR аналитики #456"), "spec_get_pr принимает полную ссылку на pull request");

const specFile = await client.callTool({
  name: "spec_read_file",
  arguments: { pr: 456, path: "payments/payment-service/callback-retry.md" },
});
const specFileText = textOf(specFile);
check(specFileText.includes("| R1 |"), "spec_read_file отдаёт таблицу требований целиком");
check(specFileText.includes("CALLBACK_RETRIES_EXHAUSTED"), "детали требований доходят до агента");

const specDiff = await client.callTool({
  name: "spec_read_file",
  arguments: { pr: 456, path: "events/payment-failed-v1.yaml", mode: "diff" },
});
check(textOf(specDiff).includes("+      - CALLBACK_RETRIES_EXHAUSTED"), "spec_read_file находит файл по хвосту пути и отдаёт diff");

const specMissing = await client.callTool({ name: "spec_read_file", arguments: { pr: 456, path: "nope.md" } });
check(specMissing.isError === true, "spec_read_file сообщает о неизвестном файле ошибкой");
check(textOf(specMissing).includes("callback-retry.md"), "в ошибке перечислены файлы, которые в PR есть");

const specBadPr = await client.callTool({ name: "spec_get_pr", arguments: { pr: "abc" } });
check(specBadPr.isError === true, "spec_get_pr отвергает неверную ссылку на PR");

console.log("\n== скилы, созданные агентом ==");
const skillTemplate = await client.callTool({ name: "skill_create", arguments: {} });
check(textOf(skillTemplate).includes("name: <skill-name>"), "skill_create без аргументов отдаёт шаблон");
check(textOf(skillTemplate).includes("Когда НЕ писать"), "в шаблоне сказано, когда скил не нужен");

const brokenYaml = await client.callTool({
  name: "skill_create",
  arguments: {
    name: "smoke-skill",
    source: "---\nname: smoke-skill\ndescription: Разбор: двоеточие ломает YAML\n---\n\nТело.\n",
  },
});
check(brokenYaml.isError === true, "skill_create отвергает frontmatter с незакавыченным двоеточием");
check(textOf(brokenYaml).includes("двоеточие"), "в отказе названа настоящая причина");

const nameMismatch = await client.callTool({
  name: "skill_create",
  arguments: { name: "smoke-skill", source: "---\nname: other\ndescription: x\n---\n\nТело.\n" },
});
check(nameMismatch.isError === true, "skill_create отвергает имя, не совпадающее с frontmatter");

const goodSkill = await client.callTool({
  name: "skill_create",
  arguments: {
    name: "smoke-skill",
    overwrite: true,
    source: "---\nname: smoke-skill\ndescription: Временный скил, созданный smoke-тестом\npriority: 5\n---\n\n# Smoke\n\n## Шаги\n\n1. Ничего.\n",
  },
});
check(goodSkill.isError !== true, "skill_create принимает корректный скил", textOf(goodSkill).slice(0, 80));
const skillFile = path.join(SERVER_DIR, ".cache", "gigacode-test", "skills", "smoke-skill", "SKILL.md");
check(await fs.access(skillFile).then(() => true, () => false), "файл скила ложится в .gigacode/skills/<имя>/SKILL.md");
check(textOf(goodSkill).includes("следующей сессии"), "агенту сказано, что скилы не подхватываются на лету");

const listed = await client.callTool({ name: "skill_create", arguments: {} });
check(textOf(listed).includes("smoke-skill"), "уже созданный скил виден в списке");

await fs.rm(path.join(SERVER_DIR, ".cache", "gigacode-test"), { recursive: true, force: true });

console.log("\n== инструменты, созданные агентом ==");
const created = await client.callTool({
  name: "tool_create",
  arguments: {
    name: "smoke_echo",
    overwrite: true,
    source: `import { defineTool, text, z } from "./_sdk.js";

export default defineTool({
  name: "smoke_echo",
  description: "Временный инструмент, созданный smoke-тестом.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({ value: z.string().describe("Anything.") }),
  async handler(input) {
    return text(\`echo:\${input.value}\`);
  },
});
`,
  },
});
check(created.isError !== true, "tool_create принимает корректный инструмент", textOf(created).slice(0, 160));

const afterCreate = (await client.listTools()).tools.map((t) => t.name);
check(afterCreate.includes("smoke_echo"), "новый инструмент появляется в tools/list без рестарта");

const echoed = await client.callTool({ name: "smoke_echo", arguments: { value: "42" } });
check(textOf(echoed) === "echo:42", "новый инструмент сразу вызывается", textOf(echoed));

const broken = await client.callTool({
  name: "tool_create",
  arguments: { name: "smoke_broken", source: "this is not valid typescript at all ((( export default" },
});
check(broken.isError === true, "tool_create отвергает несобирающийся исходник");
check(
  !(await client.listTools()).tools.some((t) => t.name === "smoke_broken"),
  "отвергнутый инструмент не регистрируется",
);
check(
  !(await fs.readdir(path.join(SERVER_DIR, "dynamic"))).includes("smoke_broken.tool.ts"),
  "после отказа файл на диске не остаётся",
);

const badArgs = await client.callTool({ name: "smoke_echo", arguments: { wrong: 1 } });
check(badArgs.isError === true, "валидация схемы отвергает неверные аргументы");

const deleted = await client.callTool({ name: "tool_delete", arguments: { name: "smoke_echo" } });
check(deleted.isError !== true, "tool_delete удаляет временный инструмент");
check(!(await client.listTools()).tools.some((t) => t.name === "smoke_echo"), "удалённый инструмент исчезает из tools/list");

await client.close();

console.log(`\n${failures === 0 ? "все проверки пройдены" : `провалено проверок: ${failures}`}\n`);
process.exit(failures === 0 ? 0 : 1);
