import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

interface DocFile {
  /** Путь относительно корня базы знаний, напр. "30-conventions/rest-api.md". */
  rel: string;
  abs: string;
  data: Record<string, any>;
  body: string;
}

/** Документы с непарсящимся frontmatter: о них сообщаем, а не прячем. */
const BROKEN: { rel: string; error: string }[] = [];

const CACHE = { root: "", mtime: 0, files: [] as DocFile[] };

async function walk(dir: string, root: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, root, acc);
    else if (/\.mdx?$/.test(entry.name)) acc.push(path.relative(root, abs));
  }
  return acc;
}

/** База знаний внешняя, поэтому «не найдена» — это проблема настройки, её надо объяснить. */
function missingBaseMessage(cfg: { aiDocsPath: string; aiDocsGitUrl: string; aiDocsRef: string }, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  const lines = [
    `База знаний недоступна по пути ${cfg.aiDocsPath}`,
    `  причина: ${reason}`,
    "",
    "База знаний живёт вне этого репозитория. Варианты:",
    "  1. указать путь к уже существующему чекауту:  AI_DOCS_PATH=/путь/к/ai-docs  в .env",
  ];
  if (cfg.aiDocsGitUrl) {
    lines.push(`  2. склонировать из ${cfg.aiDocsGitUrl} (ветка ${cfg.aiDocsRef}):  ./scripts/sync-ai-docs.sh`);
  } else {
    lines.push("  2. задать AI_DOCS_GIT_URL в .env и выполнить ./scripts/sync-ai-docs.sh");
  }
  lines.push("", "Подробно: docs/connecting-ai-docs.md");
  return lines.join("\n");
}

async function loadDocs(root: string): Promise<DocFile[]> {
  const rels = await walk(root, root);
  const files: DocFile[] = [];
  BROKEN.length = 0;
  for (const rel of rels.sort()) {
    const abs = path.join(root, rel);
    const raw = await fs.readFile(abs, "utf8");
    try {
      const parsed = matter(raw);
      files.push({ rel, abs, data: parsed.data ?? {}, body: parsed.content });
    } catch (err) {
      // Битый YAML в одном документе не должен скрывать остальные.
      BROKEN.push({ rel, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
      files.push({ rel, abs, data: {}, body: raw });
    }
  }
  if (CACHE.root !== root) CACHE.files = [];
  CACHE.root = root;
  CACHE.files = files;
  return files;
}

function scoreDoc(doc: DocFile, terms: string[]): { score: number; hits: string[] } {
  const title = String(doc.data.title ?? "").toLowerCase();
  const id = String(doc.data.id ?? "").toLowerCase();
  const tags = (Array.isArray(doc.data.tags) ? doc.data.tags : []).map((t: unknown) => String(t).toLowerCase());
  const scope = (Array.isArray(doc.data.scope) ? doc.data.scope : []).map((t: unknown) => String(t).toLowerCase());
  const rel = doc.rel.toLowerCase();
  const lines = doc.body.split("\n");

  let score = 0;
  const hits: string[] = [];

  for (const term of terms) {
    if (title.includes(term)) score += 12;
    if (id.includes(term)) score += 10;
    if (tags.some((t) => t.includes(term))) score += 8;
    if (scope.some((t) => t.includes(term))) score += 5;
    if (rel.includes(term)) score += 4;

    lines.forEach((line, i) => {
      if (!line.toLowerCase().includes(term)) return;
      score += line.startsWith("#") ? 4 : 1;
      if (hits.length < 6) hits.push(`${doc.rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
  }
  return { score, hits };
}

function describe(doc: DocFile): string {
  const bits = [
    `- ${doc.rel}`,
    doc.data.title ? `  title: ${doc.data.title}` : "",
    doc.data.id ? `  id: ${doc.data.id}` : "",
    doc.data.type ? `  type: ${doc.data.type}` : "",
    Array.isArray(doc.data.tags) && doc.data.tags.length ? `  tags: ${doc.data.tags.join(", ")}` : "",
    doc.data.status && doc.data.status !== "active" ? `  status: ${doc.data.status}` : "",
  ];
  return bits.filter(Boolean).join("\n");
}

export const docsSearch: ToolDefinition<{ query: string; type?: string; tag?: string; limit?: number }> = defineTool({
  name: "docs_search",
  title: "Поиск по базе знаний",
  description:
    "Поиск по базе знаний ai-docs: по тексту, заголовкам, тегам и frontmatter. " +
    "Возвращает ранжированные документы со строками совпадений, чтобы решить, что прочитать целиком через docs_read. " +
    "Это основной способ узнать, как у нас принято делать; догадки вместо поиска недопустимы.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: z.object({
    query: z.string().min(2).describe("Термины через пробел, например 'rest api пагинация' или 'kafka ретрай'."),
    type: z.string().optional().describe("Фильтр по полю `type` из frontmatter, если оно заполнено в вашей базе."),
    tag: z.string().optional().describe("Фильтр по одному тегу из frontmatter."),
    limit: z.number().int().min(1).max(25).optional().describe("Сколько документов вернуть, по умолчанию 8."),
  }),
  async handler(input, ctx) {
    const root = ctx.config.aiDocsPath;
    let docs: DocFile[];
    try {
      docs = await loadDocs(root);
    } catch (err) {
      return failure(missingBaseMessage(ctx.config, err));
    }

    const terms = input.query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const limit = input.limit ?? 8;

    const results = docs
      .filter((d) => (input.type ? String(d.data.type ?? "") === input.type : true))
      .filter((d) =>
        input.tag
          ? (Array.isArray(d.data.tags) ? d.data.tags : []).map(String).includes(input.tag)
          : true,
      )
      .map((doc) => ({ doc, ...scoreDoc(doc, terms) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (results.length === 0) {
      return text(
        `По запросу "${input.query}" в базе знаний ничего не найдено.\n\n` +
          `Сейчас в базе ${docs.length} документов. Вызови docs_read без аргументов, чтобы увидеть карту, ` +
          `или повтори поиск с более широкими формулировками. Если темы в базе действительно нет — скажи об этом в описании pull request, а не выдумывай конвенцию.`,
      );
    }

    const body = results
      .map((r) => `${describe(r.doc)}\n  score: ${r.score}\n${r.hits.map((h) => `    ${h}`).join("\n")}`)
      .join("\n\n");

    return text(
      `Документов по запросу "${input.query}": ${results.length}\n\n${body}\n\nПрочитай подходящие целиком через docs_read.`,
      { matches: results.map((r) => ({ path: r.doc.rel, id: r.doc.data.id ?? null, score: r.score })) },
    );
  },
});

export const docsRead: ToolDefinition<{ path?: string; section?: string }> = defineTool({
  name: "docs_read",
  title: "Чтение базы знаний",
  description:
    "Прочитать документ базы знаний по пути или по id из frontmatter. Без аргументов возвращает карту базы: " +
    "содержимое INDEX.md и каталог всех документов. С этого вызова начинается работа над любой задачей.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: z.object({
    path: z.string().optional().describe("Путь относительно корня базы, например '30-conventions/rest-api.md', либо id из frontmatter."),
    section: z.string().optional().describe("Вернуть только раздел, в заголовке которого встречается этот текст."),
  }),
  async handler(input, ctx) {
    const root = ctx.config.aiDocsPath;
    let docs: DocFile[];
    try {
      docs = await loadDocs(root);
    } catch (err) {
      return failure(missingBaseMessage(ctx.config, err));
    }

    if (!input.path) {
      const index = docs.find((d) => d.rel.toUpperCase() === "INDEX.MD");
      const catalogue = docs.map(describe).join("\n");
      const warning = BROKEN.length
        ? `\n!! Frontmatter does not parse in: ${BROKEN.map((b) => `${b.rel} (${b.error})`).join("; ")}\n`
        : "";
      return text(
        `ai-docs root: ${root}\n${warning}\n` +
          (index
            ? `=== INDEX.md ===\n${index.body.trim()}\n\n`
            : "(в корне базы нет INDEX.md — ориентируйся по каталогу ниже и docs_search)\n\n") +
          `=== Каталог (${docs.length} документов) ===\n${catalogue}`,
        { root, count: docs.length, documents: docs.map((d) => ({ path: d.rel, id: d.data.id ?? null, type: d.data.type ?? null })) },
      );
    }

    const needle = input.path.replace(/^\.?\//, "");
    const doc =
      docs.find((d) => d.rel === needle) ??
      docs.find((d) => String(d.data.id ?? "") === needle) ??
      docs.find((d) => d.rel.endsWith(needle)) ??
      docs.find((d) => d.rel.toLowerCase().includes(needle.toLowerCase()));

    if (!doc) {
      return failure(
        `Документа "${input.path}" нет. Вызови docs_read без аргументов, чтобы увидеть каталог, или найди его через docs_search.`,
      );
    }

    let body = doc.body.trim();
    if (input.section) {
      const lines = body.split("\n");
      const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(input.section!.toLowerCase()));
      if (start === -1) return failure(`В документе ${doc.rel} нет заголовка, содержащего "${input.section}".`);
      const level = (lines[start]!.match(/^#+/) ?? ["#"])[0].length;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        const m = lines[i]!.match(/^#+/);
        if (m && m[0].length <= level) { end = i; break; }
      }
      body = lines.slice(start, end).join("\n").trim();
    }

    const front = Object.keys(doc.data).length
      ? `---\n${Object.entries(doc.data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n`
      : "";

    return text(`=== ${doc.rel} ===\n${front}${body}`, { path: doc.rel, frontmatter: doc.data });
  },
});

export const docsTools = [docsSearch, docsRead];
