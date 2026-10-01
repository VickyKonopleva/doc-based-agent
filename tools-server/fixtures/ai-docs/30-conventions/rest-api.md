---
id: conv-rest-api
title: Конвенции REST API
type: convention
scope: [backend, java, spring]
tags: [rest, http, api, pagination]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Конвенции REST API

## URL

`/api/v{N}/{ресурс-во-множественном-числе}/{id}`. Глагол в URL запрещён.

## Пагинация

Курсорная для больших коллекций.

```json
{ "items": [], "nextCursor": "eyJpZCI6MTIzfQ", "totalCount": 1042 }
```

Параметры: `limit` (по умолчанию 20, максимум 100), `cursor`.

## Нельзя

- Возвращать JPA-сущность из контроллера.
- Безлимитные списки без пагинации.
