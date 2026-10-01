---
id: conv-testing
title: Тестирование
type: convention
scope: [backend, java, spring]
tags: [testing, junit, mockito, testcontainers, coverage, integration]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Тестирование

JUnit 5 + AssertJ + Mockito. Интеграционные тесты — Testcontainers.

## Пирамида

| Уровень | Доля | Что проверяет | Инструмент |
|---|---|---|---|
| unit | ~70% | доменная логика, без Spring | JUnit + Mockito |
| integration | ~25% | слой данных, эндпоинты, консьюмеры | `@SpringBootTest` + Testcontainers |
| e2e | ~5% | критичные сценарии целиком | отдельный контур |

## Именование и структура

```java
@Test
void shouldRejectPayment_whenAmountIsNegative() {
    // given
    var command = new CreatePaymentCommand(new BigDecimal("-1"), "RUB", orderId);

    // when
    var thrown = catchThrowable(() -> paymentService.create(command));

    // then
    assertThat(thrown)
            .isInstanceOf(BusinessException.class)
            .hasFieldOrPropertyWithValue("code", "VALIDATION_ERROR");
}
```

Блоки `given/when/then` обязательны. Один тест — одно утверждение по смыслу.

## Integration

```java
@SpringBootTest
@Testcontainers
@AutoConfigureMockMvc
class PaymentControllerIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");
}
```

- Суффикс `IT` для интеграционных тестов, `Test` — для unit.
- БД поднимается в Testcontainers; H2 вместо PostgreSQL запрещён — поведение
  различается.
- Внешние HTTP-зависимости — WireMock, не моки клиента, если проверяется контракт.
- Каждый тест сам готовит данные и не зависит от порядка выполнения.

## Что обязательно покрывается

- Новая или изменённая бизнес-логика.
- Каждый новый эндпоинт: успех + минимум одна ошибка.
- Каждый баг-фикс: тест, который падал бы до исправления.
- Идемпотентность консьюмера: повторная доставка того же сообщения.

## Покрытие

JaCoCo, порог для нового кода — 80% по строкам. Порог проверяется в `verify`.
Снижать порог нельзя, исключения оформляются в MR с обоснованием.

## Нельзя

- `@Disabled` без номера тикета в `value`.
- `Thread.sleep` вместо Awaitility.
- Моки доменных объектов (мокаются только порты и внешние зависимости).
- Тест, зависящий от текущего времени: время внедряется через `Clock`.
- Ассерты вида `assertNotNull(result)` как единственная проверка.
