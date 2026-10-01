import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { Config } from "../lib/config.js";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

const SKILL_NAME = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "priority",
  "paths",
  "user-invocable",
  "disable-model-invocation",
]);
const MAX_DESCRIPTION = 1000;
const MAX_BODY = 10_000;

const TEMPLATE = `---
name: <skill-name>
description: Что делает скил и когда его применять. Это единственное, по чему модель решит его вызвать.
priority: 10
# paths:                      # необязательно: активировать только при работе с такими файлами
#   - '**/db/changelog/**'
---

# <Название>

## Когда применять

Один абзац: в какой ситуации эта процедура нужна.

## Шаги

1. ...
2. ...

## Результат

Что должно получиться на выходе.

## Стоп-ситуации

Когда остановиться и спросить человека.
`;

interface SkillInfo {
  name: string;
  description: string;
  paths?: string[];
}

async function listSkills(dir: string): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const name of entries.sort()) {
    try {
      const raw = await fs.readFile(path.join(dir, name, "SKILL.md"), "utf8");
      const { data } = matter(raw);
      out.push({ name: String(data.name ?? name), description: String(data.description ?? ""), paths: data.paths });
    } catch {
      /* каталог без валидного SKILL.md скилом не является */
    }
  }
  return out;
}

/** Те же проверки, что и в `npm run check` — но до того, как файл станет виден CLI. */
function validate(name: string, source: string): string[] {
  const errors: string[] = [];
  let data: Record<string, any>;
  let body: string;

  try {
    const parsed = matter(source);
    data = parsed.data ?? {};
    body = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return [
      `frontmatter не парсится: ${message}`,
      "частая причина — двоеточие внутри незакавыченного значения: " +
        'пиши `description: "Разбор: что-то"` или замени двоеточие на тире',
    ];
  }

  if (!data.name) errors.push("нет обязательного поля name");
  else if (String(data.name) !== name) errors.push(`frontmatter name="${data.name}" не совпадает с именем скила "${name}"`);

  if (!data.description) errors.push("нет обязательного поля description");
  else if (String(data.description).length > MAX_DESCRIPTION) {
    errors.push(`description ${String(data.description).length} символов, максимум ${MAX_DESCRIPTION}`);
  }

  if (!body.trim()) errors.push("пустое тело: инструкции скила обязательны");
  else if (body.trim().length > MAX_BODY) errors.push(`тело ${body.trim().length} символов, максимум ${MAX_BODY}`);

  if (data.priority !== undefined && typeof data.priority !== "number") errors.push("priority должен быть числом");
  if (data.paths !== undefined && !Array.isArray(data.paths)) errors.push("paths должен быть YAML-массивом строк");

  const unknown = Object.keys(data).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknown.length) errors.push(`неизвестные поля frontmatter: ${unknown.join(", ")}`);

  return errors;
}

export const skillCreate: ToolDefinition<{ name: string; source: string; overwrite?: boolean }> = defineTool({
  name: "skill_create",
  title: "Создать скил",
  description:
    "Создать собственный скил — процедуру с шагами, которую ты будешь переиспользовать в следующих задачах. " +
    "Пиши скил, когда поймал повторяющуюся последовательность шагов, которой нет в базе знаний как документа: " +
    "база знаний отвечает на вопрос «что принято», скил — «как это выполнить». " +
    "Правила компании в скил не копируются, на них даётся ссылка, иначе копии разойдутся. " +
    "Передай полный текст SKILL.md с YAML frontmatter; вызови без аргументов source, чтобы получить шаблон и список существующих скилов. " +
    "Скил проверяется перед записью и подхватывается CLI со следующей сессии.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  inputSchema: z.object({
    name: z.string().optional().describe("Имя скила в kebab-case, оно же имя каталога. Должно совпадать с полем name во frontmatter."),
    source: z.string().optional().describe("Полный текст SKILL.md. Не передавай, чтобы получить шаблон и список существующих скилов."),
    overwrite: z.boolean().optional().describe("Перезаписать существующий скил с тем же именем (по умолчанию false)."),
  }) as unknown as z.ZodType<{ name: string; source: string; overwrite?: boolean }>,
  async handler(input, ctx) {
    const cfg = ctx.config;
    const dir = path.join(cfg.gigacodeDir, "skills");
    const existing = await listSkills(dir);

    if (!input.source || !input.name) {
      return text(
        [
          "Шаблон SKILL.md:",
          "",
          "```markdown",
          TEMPLATE.trim(),
          "```",
          "",
          `Файл ляжет в ${dir}/<name>/SKILL.md. Рядом можно класть templates/ и scripts/.`,
          "",
          "Когда писать скил:",
          "- последовательность шагов повторится в следующих задачах;",
          "- её нет в базе знаний как документа (иначе место правила — там);",
          "- либо она привязана к типу файлов — тогда задай `paths:`, и скил включится сам,",
          "  как только tool call коснётся подходящего файла.",
          "",
          "Сначала убедись, что процедуры нет иначе: её может покрывать документ",
          "базы знаний или инструмент подключённого MCP-сервера.",
          "",
          "Когда НЕ писать:",
          "- это правило компании — ему место в базе знаний, предложи документ в описании pull request;",
          "- это одноразовая процедура в рамках одной задачи;",
          "- это детерминированная операция без суждения — тогда нужен инструмент, см. tool_template.",
          "",
          existing.length
            ? "Уже есть:\n" + existing.map((s) => `  ${s.name} — ${s.description.slice(0, 90)}`).join("\n")
            : "Своих скилов пока нет.",
        ].join("\n"),
        { skills: existing as unknown as Record<string, unknown>[], dir },
      );
    }

    if (!cfg.allowSkillAuthoring) return failure("Создание скилов отключено (SKILLS_ALLOW_CREATE=false).");
    if (!SKILL_NAME.test(input.name)) {
      return failure(`Недопустимое имя "${input.name}". Нужен kebab-case из строчных букв, цифр, дефиса и точки, 2–48 символов.`);
    }

    const skillDir = path.join(dir, input.name);
    const file = path.join(skillDir, "SKILL.md");
    const alreadyExists = existing.some((s) => s.name === input.name);
    if (alreadyExists && !input.overwrite) {
      return failure(`Скил "${input.name}" уже существует. Передай overwrite: true, чтобы заменить.`);
    }

    const errors = validate(input.name, input.source);
    if (errors.length) {
      return failure(`Скил "${input.name}" не создан, на диске ничего не изменилось:\n` + errors.map((e) => `  - ${e}`).join("\n"));
    }

    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(file, input.source.endsWith("\n") ? input.source : input.source + "\n", "utf8");
    ctx.logger.info("skill created", { name: input.name, file });

    return text(
      `Скил "${input.name}" записан в ${path.relative(cfg.gigacodeDir, file)}.\n` +
        "В отличие от инструментов, скилы не подхватываются на лету: он станет доступен в следующей сессии " +
        "(или после обновления кеша скилов). В текущей задаче продолжай по шагам, которые в него записал.\n" +
        "Файл попадает в pull request и проходит ревью наравне с кодом.",
      { created: input.name, file },
    );
  },
});

export function skillTools(_cfg: Config): ToolDefinition<any>[] {
  return [skillCreate];
}
