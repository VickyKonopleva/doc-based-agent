---
id: conv-error-handling
title: Обработка ошибок
type: convention
scope: [backend, java, spring]
tags: [errors, exceptions, problem-details, rfc7807, validation]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Обработка ошибок

## Формат ответа

RFC 7807 Problem Details, `Content-Type: application/problem+json`:

```json
{
  "type": "https://errors.company.ru/payment/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Недостаточно средств для списания 100.50 RUB",
  "instance": "/api/v1/payments",
  "code": "PAYMENT_INSUFFICIENT_FUNDS",
  "traceId": "00-4bf92f...-01",
  "errors": [
    { "field": "amount", "message": "must be positive" }
  ]
}
```

`code` — стабильный машинный идентификатор в `UPPER_SNAKE_CASE`, по нему
интегрируются клиенты. `detail` — для человека, может меняться.

## Иерархия исключений

```java
public abstract class BusinessException extends RuntimeException {
    private final String code;
    private final HttpStatus status;
    protected BusinessException(String code, HttpStatus status, String message) { ... }
}

public class PaymentNotFoundException extends BusinessException {
    public PaymentNotFoundException(PaymentId id) {
        super("PAYMENT_NOT_FOUND", HttpStatus.NOT_FOUND, "Платёж %s не найден".formatted(id));
    }
}
```

## Единая точка преобразования

```java
@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    ProblemDetail onBusiness(BusinessException ex) { ... }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail onValidation(MethodArgumentNotValidException ex) { ... }

    @ExceptionHandler(Exception.class)
    ProblemDetail onUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);     // стектрейс только в лог
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "Внутренняя ошибка сервиса");     // наружу — без деталей
    }
}
```

## Выбор статуса

| Ситуация | Статус | `code` |
|---|---|---|
| невалидный ввод | 400 | `VALIDATION_ERROR` |
| не аутентифицирован | 401 | `UNAUTHENTICATED` |
| нет прав | 403 | `FORBIDDEN` |
| объект не найден | 404 | `<DOMAIN>_NOT_FOUND` |
| конфликт состояния | 409 | `<DOMAIN>_CONFLICT` |
| бизнес-правило нарушено | 422 | доменный код |
| внешняя система недоступна | 503 | `UPSTREAM_UNAVAILABLE` |

## Правила

- Исключение бросается там, где обнаружена проблема, и обрабатывается один раз —
  в `@RestControllerAdvice`.
- Наружу не попадают: стектрейс, SQL, имена таблиц, внутренние хосты.
- `traceId` возвращается всегда — по нему ищут в логах.
- Проверяемые исключения в доменном слое не используются.

## Нельзя

- `catch (Exception e) {}`.
- Возврат `null` вместо ошибки.
- `throw new RuntimeException("ошибка")` без кода.
- Текст ошибки, собранный из пользовательского ввода, без экранирования.
