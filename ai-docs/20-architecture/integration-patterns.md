---
id: arch-integration
title: "Интеграции: REST, Kafka, устойчивость"
type: architecture
scope: [backend, java, spring]
tags: [kafka, rest, retry, idempotency, outbox, resilience, timeout]
status: active
owner: architecture-chapter
updated: 2026-10-01
---

# Интеграции

## Выбор способа

| Нужен ответ синхронно? | Потребитель один? | Решение |
|---|---|---|
| да | да | REST-вызов |
| нет | да | Kafka, топик-команда |
| нет | много | Kafka, топик-событие |

## Исходящие HTTP-вызовы

Обязательно: таймаут на соединение и на чтение, ограничение числа ретраев,
circuit breaker для некритичных зависимостей.

```java
@Bean
RestClient paymentGatewayClient(RestClient.Builder builder, GatewayProperties props) {
    var factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(Duration.ofSeconds(2));
    factory.setReadTimeout(Duration.ofSeconds(5));
    return builder.baseUrl(props.baseUrl()).requestFactory(factory).build();
}
```

Ретраить можно только идемпотентные операции (GET, PUT, DELETE) и те POST,
которые защищены ключом идемпотентности. Ретрай — экспоненциальный, с джиттером,
не более трёх попыток.

## Kafka

- Имя топика: `<домен>.<сущность>.<событие>.v<версия>`, например
  `payment.payment.completed.v1`.
- Ключ сообщения — бизнес-идентификатор агрегата (гарантирует порядок).
- Схема события версионируется; удаление поля — новая версия топика.
- Консьюмер **идемпотентен**: доставка at-least-once, дубликаты неизбежны.
- Необрабатываемое сообщение уходит в DLT `<topic>.dlt`, а не роняет консьюмер.

## Идемпотентность

Входящая операция, меняющая состояние, принимает ключ идемпотентности
(заголовок `Idempotency-Key` для REST, идентификатор события для Kafka).
Результат первой обработки сохраняется и возвращается при повторе.

## Транзакция + отправка события

Нельзя писать в БД и публиковать в Kafka в одной «логической» транзакции —
это не атомарно. Использовать transactional outbox: событие пишется в таблицу
в той же транзакции, отдельный процесс публикует его.

## Нельзя

- Вызов без таймаута.
- Ретрай неидемпотентного POST.
- Бесконечный ретрай внутри консьюмера.
- Публикация события до коммита транзакции.
