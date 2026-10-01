import { z } from "zod";
import type { Config } from "../lib/config.js";
import { defineTool, text, type ToolDefinition } from "../lib/types.js";

/**
 * Единственный инструмент, который рассказывает агенту про его окружение.
 *
 * Он намеренно ничего не умеет, кроме как показать координаты: куда ходить за
 * базой знаний, спецификацией, репозиториями сервисов и артефактами. Что с
 * этими координатами делать — решает агент. Секреты не раскрываются: про токен
 * сообщается только, задан он или нет.
 */
export const agentContext: ToolDefinition<Record<string, never>> = defineTool({
  name: "agent_context",
  title: "Окружение агента",
  description:
    "Показать координаты окружения: адреса Nexus и репозиториев, префикс и суффикс имён сервисов, " +
    "правило именования артефактов, куда складываются рабочие копии, какие источники отданы внешним MCP-серверам. " +
    "Вызывай в начале задачи и всякий раз, когда нужен адрес внешней системы — не угадывай его и не бери из памяти. " +
    "Инструмент только сообщает адреса; как с ними работать, решаешь ты.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const c = ctx.config;
    const yes = (v: string) => (v ? "задан" : "не задан");
    const suffixes = c.nexus.artifactSuffixes;
    const example = `<сервис>${c.services.suffix}` ;

    return text(
      [
        "# Окружение",
        "",
        "## База знаний",
        `  путь: ${c.aiDocsPath}`,
        c.aiDocsGitUrl ? `  репозиторий: ${c.aiDocsGitUrl} (${c.aiDocsRef})` : "  репозиторий: не задан, используется локальный путь",
        "",
        "## Репозиторий аналитики",
        `  источник: ${c.spec.provider}${c.spec.provider === "external" ? " — читает внешний MCP-сервер" : ""}`,
        c.spec.provider === "external" ? "" : `  адрес: ${c.spec.baseUrl || "не задан"}`,
        c.spec.provider === "external" ? "" : `  репозиторий: ${c.spec.projectId || "не задан"}`,
        "",
        "## Сервисы",
        `  префикс адреса: ${c.services.gitBase || "не задан"}`,
        `  проект в API: ${c.services.group || "не задан"}`,
        `  суффикс имени: ${c.services.suffix}`,
        `  целевая ветка: ${c.services.defaultBranch}`,
        `  рабочие копии: ${c.services.workspacesDir}`,
        `  список репозиториев: ${c.services.provider}${c.services.provider === "external" ? " — отдаёт внешний MCP-сервер" : ""}`,
        "",
        "## Nexus",
        `  адрес: ${c.nexus.url || "НЕ ЗАДАН — спроси человека, без него шаг с версиями не выполнить"}`,
        `  репозиторий: ${c.nexus.repository || "не задан, определи сам"}`,
        `  доступ: ${c.nexus.user ? `пользователь ${c.nexus.user}, пароль ${yes(c.nexus.token)}` : `токен ${yes(c.nexus.token)}`}`,
        `  артефакты сервиса: ${suffixes.map((sfx) => `${example}${sfx}`).join(", ")}`,
        "",
        "  Как искать версии — решаешь сам: у Nexus есть и REST API, и прямой доступ",
        "  к maven-metadata.xml в репозитории. Начни с того, что посмотри, что отвечает",
        "  этот адрес, и выбери способ. Разобравшись, оформи найденный способ",
        "  инструментом через tool_create, чтобы не повторять разведку в следующий раз.",
        "",
        "## Тикеты",
        `  источник: ${c.jira.provider}${c.jira.provider === "external" ? " — читает внешний MCP-сервер" : ""}`,
        c.jira.provider === "external" ? "" : `  адрес: ${c.jira.baseUrl || "не задан"}`,
      ].filter((l) => l !== "").join("\n"),
      {
        aiDocsPath: c.aiDocsPath,
        services: {
          gitBase: c.services.gitBase,
          group: c.services.group,
          suffix: c.services.suffix,
          workspacesDir: c.services.workspacesDir,
          defaultBranch: c.services.defaultBranch,
        },
        nexus: {
          url: c.nexus.url,
          repository: c.nexus.repository,
          artifactSuffixes: suffixes,
          hasCredentials: Boolean(c.nexus.token || c.nexus.user),
        },
        providers: { spec: c.spec.provider, services: c.services.provider, jira: c.jira.provider },
      },
    );
  },
});

export function contextTools(_cfg: Config): ToolDefinition<any>[] {
  return [agentContext];
}
