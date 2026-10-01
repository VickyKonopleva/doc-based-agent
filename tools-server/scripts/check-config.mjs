/**
 * Проверка конфигурации .gigacode: YAML frontmatter агентов, скилов и команд
 * плюс JSON профилей settings. Двоеточие внутри незакавыченного значения
 * ломает YAML молча — агент просто не загрузится, поэтому проверка постоянная.
 *
 *   npm run check
 */
import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GC = path.resolve(SERVER_DIR, "..", ".gigacode");

const LIMITS = { description: 1000, body: 10000 };
const AGENT_FIELDS = new Set(["name", "description", "model", "approvalMode", "tools", "disallowedTools"]);
const SKILL_FIELDS = new Set(["name", "description", "priority", "paths", "user-invocable", "disable-model-invocation"]);
const COMMAND_FIELDS = new Set(["description"]);
const SKILL_NAME = /^[\p{L}\p{N}_:.-]+$/u;

let problems = 0;
const fail = (where, msg) => { problems++; console.log(`  FAIL ${where}: ${msg}`); };
const ok = (where, note = "") => console.log(`  ok   ${where.padEnd(36)}${note}`);

function listDir(dir, filter = () => true) {
  try { return fs.readdirSync(dir).filter(filter); } catch { return []; }
}

function checkMarkdown(file, label, allowed, { requireName }) {
  const before = problems;
  const raw = fs.readFileSync(file, "utf8");
  let data, content;
  try {
    ({ data, content } = matter(raw));
  } catch (err) {
    return fail(label, `frontmatter не парсится — ${err.message.split("\n")[0]}
         подсказка: двоеточие внутри значения нужно закавычить или заменить на тире`);
  }

  if (requireName && !data.name) return fail(label, "нет обязательного поля name");
  if (!data.description) return fail(label, "нет обязательного поля description");
  if (requireName && !SKILL_NAME.test(String(data.name))) {
    return fail(label, `недопустимое имя "${data.name}" — только буквы, цифры, _ : . -`);
  }

  const unknown = Object.keys(data).filter((k) => !allowed.has(k));
  if (unknown.length) fail(label, `неизвестные поля: ${unknown.join(", ")}`);

  if (data.tools !== undefined && !Array.isArray(data.tools)) fail(label, "tools должен быть YAML-массивом");
  if (data.disallowedTools !== undefined && !Array.isArray(data.disallowedTools)) fail(label, "disallowedTools должен быть YAML-массивом");
  if (data.paths !== undefined && !Array.isArray(data.paths)) fail(label, "paths должен быть YAML-массивом");

  const d = String(data.description).length;
  const b = content.trim().length;
  if (d > LIMITS.description) fail(label, `description ${d} символов, рекомендуемый максимум ${LIMITS.description}`);
  if (b > LIMITS.body) fail(label, `system prompt ${b} символов, рекомендуемый максимум ${LIMITS.body}`);
  if (!content.trim()) fail(label, "пустое тело — system prompt обязателен");

  if (problems === before) ok(label, `description=${d} body=${b}`);
}

console.log("\nАгенты (.gigacode/agents)");
const agentFiles = listDir(path.join(GC, "agents"), (f) => f.endsWith(".md"));
if (!agentFiles.length) fail("agents", "ни одного агента не найдено");
for (const f of agentFiles) checkMarkdown(path.join(GC, "agents", f), `agents/${f}`, AGENT_FIELDS, { requireName: true });

console.log("\nСкилы (.gigacode/skills)");
const skillDirs = listDir(path.join(GC, "skills")).filter((d) => fs.statSync(path.join(GC, "skills", d)).isDirectory());
for (const d of skillDirs) {
  const file = path.join(GC, "skills", d, "SKILL.md");
  if (!fs.existsSync(file)) { fail(`skills/${d}`, "нет SKILL.md — каталог не будет распознан как скил"); continue; }
  checkMarkdown(file, `skills/${d}/SKILL.md`, SKILL_FIELDS, { requireName: true });
}
if (!skillDirs.length) console.log("  (скилов нет)");

console.log("\nКоманды (.gigacode/commands)");
for (const f of listDir(path.join(GC, "commands"), (f) => f.endsWith(".md"))) {
  const file = path.join(GC, "commands", f);
  checkMarkdown(file, `commands/${f}`, COMMAND_FIELDS, { requireName: false });
  const body = fs.readFileSync(file, "utf8");
  if (body.includes("$ARGUMENTS")) fail(`commands/${f}`, "используется $ARGUMENTS; в GigaCode подстановка называется {{args}}");
}

console.log("\nПрофили settings");
for (const f of listDir(GC, (f) => f.startsWith("settings") && f.endsWith(".json"))) {
  const file = path.join(GC, f);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (err) { fail(f, `невалидный JSON — ${err.message}`); continue; }

  const servers = cfg.mcpServers ?? {};
  if (!Object.keys(servers).length) { fail(f, "пустой mcpServers"); continue; }
  for (const [name, s] of Object.entries(servers)) {
    if (!s.command && !s.url && !s.httpUrl) fail(f, `сервер "${name}": нужен command, url или httpUrl`);
    if (s.command && s.cwd && !fs.existsSync(path.resolve(GC, "..", s.cwd))) {
      fail(f, `сервер "${name}": cwd "${s.cwd}" не существует`);
    }
    if (name === "be-tools" && s.includeTools) {
      fail(f, "у be-tools задан includeTools — созданные на лету инструменты окажутся недоступны");
    }
  }
  const allowed = cfg.mcp?.allowed ?? [];
  for (const n of allowed) if (!servers[n]) fail(f, `mcp.allowed содержит "${n}", которого нет в mcpServers`);
  for (const n of Object.keys(servers)) if (allowed.length && !allowed.includes(n)) {
    fail(f, `сервер "${n}" объявлен, но не входит в mcp.allowed`);
  }
  ok(f, `серверы: ${Object.keys(servers).join(", ")}`);
}

console.log(problems === 0 ? "\nконфигурация в порядке\n" : `\n${problems} проблем(ы) в конфигурации\n`);
process.exit(problems === 0 ? 0 : 1);
