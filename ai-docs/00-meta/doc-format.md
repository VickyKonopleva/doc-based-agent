---
id: meta-doc-format
title: Формат документа базы знаний
type: meta
tags: [meta, frontmatter, format]
status: active
updated: 2026-10-01
---

# Формат документа базы знаний

## Frontmatter

Каждый `.md` начинается с YAML-блока. Поля `id`, `title`, `type` обязательны —
по ним работают `docs_search` и `docs_read`.

```yaml
---
id: conv-rest-api            # уникальный, стабильный; на него ссылаются
title: Конвенции REST API    # человекочитаемое название
type: convention             # meta | process | architecture | adr | convention | project | runbook | glossary
scope: [backend, java, spring]
tags: [rest, http, api, pagination]
status: active               # active | draft | deprecated
owner: platform-team
updated: 2026-09-15
---
```

`status: deprecated` не удаляет документ из поиска, но агент обязан его
игнорировать при выборе решения и упомянуть, если он нашёлся первым.

## Тело

- Один документ — одна тема. Лучше пять коротких, чем один длинный.
- Заголовки `##` — то, что агент может запросить секцией через
  `docs_read(path, section)`. Делайте их самодостаточными.
- Правила — императивом. «Используйте `record` для DTO», а не «обычно DTO
  делают через record».
- Запреты — явным блоком `## Нельзя`.
- Каждое нетривиальное правило сопровождается примером кода. Агент
  воспроизводит примеры точнее, чем прозу.

## Шаблон

```markdown
---
id: conv-example
title: Название
type: convention
scope: [backend]
tags: []
status: active
owner: team
updated: 2026-10-01
---

# Название

## Правило
...

## Пример

​```java
...
​```

## Нельзя
- ...

## Связанные документы
- `30-conventions/...`
```
