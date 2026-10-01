---
id: project-payment-service
title: payment-service
type: project
scope: [backend, java, spring, payments]
tags: [payment, kafka, postgres, service]
status: active
owner: payments-team
updated: 2026-10-01
---

# payment-service

> Пример заполненной карточки. Замените на реальные сервисы вашего контура —
> агент опирается на эти данные, чтобы определить, где именно делать изменение.

## Назначение

Приём, проведение и возврат платежей по заказам. Взаимодействует с внешним
платёжным шлюзом. **Не** занимается: расчётом цены, скидками, фискализацией.

## Репозиторий и сборка

- Git: `git@git.company.ru:payments/payment-service.git`
- Сборка: `./mvnw clean verify`
- Java 21, Spring Boot 3.3
- Главный пакет: `ru.company.payment`
- Целевая ветка MR: `master`

## Владелец

`payments-team`, канал `#payments-dev`.

## Хранилище

PostgreSQL, схема `payment`. Основные таблицы: `payment`, `payment_attempt`,
`outbox_event`. Миграции: `src/main/resources/db/changelog/`.

## Входящие интерфейсы

| Тип | Адрес/топик | Описание |
|---|---|---|
| REST | `POST /api/v1/payments` | создать платёж |
| REST | `GET /api/v1/payments/{id}` | статус платежа |
| REST | `POST /api/v1/payments/{id}/refunds` | возврат |
| Kafka | `order.order.created.v1` | создать платёж по новому заказу |

## Исходящие зависимости

| Система | Протокол | Таймаут | Поведение при отказе |
|---|---|---|---|
| Платёжный шлюз | HTTPS | 2s/5s | 3 ретрая с джиттером, затем статус `PENDING` |
| order-service | HTTPS | 1s/3s | кэш последнего ответа, иначе 503 |

## Публикуемые события

| Топик | Ключ | Когда |
|---|---|---|
| `payment.payment.completed.v1` | `paymentId` | платёж успешно проведён |
| `payment.payment.failed.v1` | `paymentId` | исчерпаны ретраи |

Публикация — через transactional outbox (`arch-integration`).

## Особенности и отклонения

- Статусная модель платежа — конечный автомат в `domain/model/PaymentStatus`;
  переходы валидируются, произвольная смена статуса запрещена.
- Все операции изменения требуют заголовка `Idempotency-Key`.

## Частые задачи

**Добавить поле в ответ API:** DTO в `api/rest/dto` → маппер → тест контроллера
→ регенерировать `docs/openapi.yaml`.

**Добавить поле в событие:** новая версия топика при удалении/переименовании,
иначе — опциональное поле + обновление схемы и тестов консьюмеров.
