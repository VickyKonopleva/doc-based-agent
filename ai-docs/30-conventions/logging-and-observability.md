---
id: conv-observability
title: Логи, метрики, трейсинг
type: convention
scope: [backend, java, spring]
tags: [logging, slf4j, metrics, micrometer, tracing, mdc, observability]
status: active
owner: platform-team
updated: 2026-10-01
---

# Логи, метрики, трейсинг

## Логи

SLF4J (`@Slf4j`), вывод в stdout в JSON, параметризованные сообщения.

```java
log.info("Payment created paymentId={} orderId={} amount={} {}",
        payment.id(), payment.orderId(), payment.amount(), payment.currency());
```

Уровни:

| Уровень | Когда |
|---|---|
| ERROR | операция провалилась, нужно вмешательство человека |
| WARN | деградация, отработал фолбэк, близко к лимиту |
| INFO | бизнес-событие: создано, подтверждено, отменено |
| DEBUG | детали для разбора, выключены в prod |
| TRACE | не используем |

Правила:

- Сообщение — на английском, значения — через `{}`, без конкатенации.
- Ошибка логируется один раз, на границе обработки, вместе с исключением:
  `log.error("...", ex)`.
- В MDC всегда есть `traceId`; бизнес-контекст (`paymentId`, `orderId`) —
  параметрами сообщения.

### В логи нельзя

Пароли, токены, заголовки `Authorization`, номера карт и CVV, ПДн (ФИО, телефон,
email, паспорт), полные тела запросов с чувствительными данными. При
необходимости — маскировать: `4111****1111`.

## Метрики

Micrometer, экспорт в Prometheus через `/actuator/prometheus`.

```java
Counter.builder("payment.processed")
       .tag("status", status.name())
       .register(meterRegistry)
       .increment();
```

- Имя метрики — `snake.case` с доменным префиксом.
- Теги — только с конечным множеством значений. `paymentId` тегом — запрещено
  (кардинальность).
- Для каждой внешней интеграции: счётчик вызовов, счётчик ошибок, таймер
  латентности.

## Трейсинг

Micrometer Tracing + OpenTelemetry. `traceId` прокидывается во все исходящие
вызовы и в заголовки Kafka-сообщений. Ручные спаны — только вокруг значимых
бизнес-операций.

## Health

`/actuator/health/liveness` и `/readiness` обязательны и не должны ходить во
внешние системы в liveness-проверке.
