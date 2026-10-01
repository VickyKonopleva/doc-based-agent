import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import { defineTool, failure, text, type ToolDefinition } from "../lib/types.js";

interface DocFile {
  /** Path relative to the ai-docs root, e.g. "30-conventions/rest-api.md". */
  rel: string;
  abs: string;
  data: Record<string, any>;
  body: string;
}

/** Documents whose frontmatter does not parse, reported instead of hidden. */
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
      // Broken YAML in one document must not hide the other 27.
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
  title: "Search ai-docs",
  description:
    "Full-text and metadata search over the ai-docs knowledge base (conventions, architecture, process, project cards, runbooks). " +
    "Returns ranked documents with matching lines so you can decide what to read in full with docs_read. " +
    "This is the primary way to find out how things must be done in this company — prefer it over guessing.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: z.object({
    query: z.string().min(2).describe("Space-separated terms, e.g. 'rest api pagination' or 'kafka retry'."),
    type: z.string().optional().describe("Filter by frontmatter `type`: convention | architecture | process | project | runbook | adr | glossary | meta."),
    tag: z.string().optional().describe("Filter by a single frontmatter tag."),
    limit: z.number().int().min(1).max(25).optional().describe("Max documents to return (default 8)."),
  }),
  async handler(input, ctx) {
    const root = ctx.config.aiDocsPath;
    let docs: DocFile[];
    try {
      docs = await loadDocs(root);
    } catch (err) {
      return failure(`Cannot read ai-docs at ${root}: ${err instanceof Error ? err.message : String(err)}`);
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
        `No ai-docs match "${input.query}".\n\n` +
          `The knowledge base currently holds ${docs.length} documents. Call docs_read with no arguments to see the full map, ` +
          `or retry with broader terms. If the topic is genuinely undocumented, say so in the merge request instead of inventing a convention.`,
      );
    }

    const body = results
      .map((r) => `${describe(r.doc)}\n  score: ${r.score}\n${r.hits.map((h) => `    ${h}`).join("\n")}`)
      .join("\n\n");

    return text(
      `${results.length} document(s) matching "${input.query}":\n\n${body}\n\nRead the relevant ones in full with docs_read.`,
      { matches: results.map((r) => ({ path: r.doc.rel, id: r.doc.data.id ?? null, score: r.score })) },
    );
  },
});

export const docsRead: ToolDefinition<{ path?: string; section?: string }> = defineTool({
  name: "docs_read",
  title: "Read ai-docs",
  description:
    "Read a document from ai-docs by its path (or by frontmatter id). Called with no arguments it returns the catalogue: " +
    "the knowledge-base map plus every document with its id, title and type. Start every ticket with an argument-less call.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: z.object({
    path: z.string().optional().describe("Path relative to ai-docs root, e.g. '30-conventions/rest-api.md', or a frontmatter id."),
    section: z.string().optional().describe("Return only the markdown section whose heading contains this text."),
  }),
  async handler(input, ctx) {
    const root = ctx.config.aiDocsPath;
    let docs: DocFile[];
    try {
      docs = await loadDocs(root);
    } catch (err) {
      return failure(`Cannot read ai-docs at ${root}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!input.path) {
      const index = docs.find((d) => d.rel.toUpperCase() === "INDEX.MD");
      const catalogue = docs.map(describe).join("\n");
      const warning = BROKEN.length
        ? `\n!! Frontmatter does not parse in: ${BROKEN.map((b) => `${b.rel} (${b.error})`).join("; ")}\n`
        : "";
      return text(
        `ai-docs root: ${root}\n${warning}\n` +
          (index ? `=== INDEX.md ===\n${index.body.trim()}\n\n` : "") +
          `=== Catalogue (${docs.length} documents) ===\n${catalogue}`,
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
        `No such document: "${input.path}". Call docs_read with no arguments for the catalogue, or docs_search to find it.`,
      );
    }

    let body = doc.body.trim();
    if (input.section) {
      const lines = body.split("\n");
      const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(input.section!.toLowerCase()));
      if (start === -1) return failure(`Document ${doc.rel} has no heading matching "${input.section}".`);
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
