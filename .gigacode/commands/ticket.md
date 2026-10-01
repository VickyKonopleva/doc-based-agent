---
description: Взять тикет Jira в работу и довести до draft merge request
argument-hint: <TICKET-123>
allowed-tools: docs_read, docs_search, jira_get_issue, tool_list, tool_template, tool_create, Read, Write, Edit, Glob, Grep, Bash
---

Возьми в работу тикет `$ARGUMENTS`.

Работай строго по роли из `.gigacode/agents/backend-developer.md`. Начни с трёх
вызовов: `docs_read()` без аргументов, затем
`docs_read("10-process/ticket-lifecycle.md")`, затем
`jira_get_issue("$ARGUMENTS")`.

Не вноси ни одного изменения в файлы, пока не выдашь план с перечнем
применяемых конвенций (их `id` из ai-docs).
