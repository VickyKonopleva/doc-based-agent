---
id: conv-rest-api
title: Конвенции REST API
type: convention
scope: [backend, java, spring]
tags: [rest, http, api, pagination, versioning, dto, openapi]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Конвенции REST API

## URL

```
/api/v{N}/{ресурс-во-множественном-числе}/{id}/{подресурс}
```

- Только существительные, kebab-case, множественное число: `/api/v1/payment-orders`.
- Глагол в URL запрещён. Действие, не укладывающееся в CRUD, оформляется как
  подресурс состояния: `POST /api/v1/payments/{id}/refunds`.
- Версия — в пути, меняется только при несовместимом изменении.

## Методы и коды

| Операция | Метод | Успех | Типичные ошибки |
|---|---|---|---|
| список | GET | 200 | 400 |
| один объект | GET | 200 | 404 |
| создание | POST | 201 + `Location` | 400, 409, 422 |
| полная замена | PUT | 200 / 204 | 404, 409 |
| частичное изменение | PATCH | 200 | 404, 422 |
| удаление | DELETE | 204 | 404 |

`200` с телом-ошибкой запрещён: статус отражает результат.

## Формат полей

- JSON, `camelCase`.
- Даты и время — ISO-8601 в UTC: `2026-10-01T12:30:00Z`.
- Деньги — строка с десятичной точкой + отдельное поле валюты:
  `{"amount": "100.50", "currency": "RUB"}`.
- Идентификаторы — строки, даже если внутри это UUID или число.
- Отсутствующее значение — поле опускается, а не `null`.

## Пагинация

Только курсорная для больших коллекций, offset — для админских экранов.

```json
{
  "items": [],
  "nextCursor": "eyJpZCI6MTIzfQ",
  "totalCount": 1042
}
```

Параметры: `limit` (по умолчанию 20, максимум 100), `cursor`.

## Ошибки

Единый формат — RFC 7807, см. `conv-error-handling`.

## Контракт

- OpenAPI-спецификация генерируется из кода и коммитится в `docs/openapi.yaml`.
- Любое изменение контракта отражается в описании MR.
- Удаление или переименование поля ответа — breaking change, требует новой версии.

## Пример

```java
@GetMapping
PageResponse<PaymentResponse> list(
        @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
        @RequestParam(required = false) String cursor) {
    return paymentService.list(limit, cursor);
}
```

## Нельзя

- Передавать секреты или ПДн в query-параметрах.
- Возвращать JPA-сущность из контроллера.
- Безлимитные списки без пагинации.
- Разные форматы ошибок в одном сервисе.
