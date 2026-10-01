---
id: conv-java-style
title: Стиль кода Java
type: convention
scope: [backend, java]
tags: [java, style, naming, lombok, records, formatting]
status: active
owner: backend-chapter
updated: 2026-10-01
---

# Стиль кода Java

Базовый стандарт — Java 21, Google Java Style с отступом 4 пробела и лимитом
строки 120 символов. Форматирование проверяется Spotless в `verify`.

## Именование

| Сущность | Правило | Пример |
|---|---|---|
| класс | существительное, UpperCamelCase | `PaymentProcessor` |
| интерфейс | без префикса `I` | `PaymentRepository` |
| реализация | не `Impl`, а по сути | `JpaPaymentRepository` |
| метод | глагол | `findByStatus`, `calculateFee` |
| булев метод | `is`/`has`/`can` | `isExpired` |
| константа | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| тест | `should<Ожидание>_when<Условие>` | `shouldRejectPayment_whenAmountIsNegative` |

## Обязательное

- `final` на полях, которые не меняются; локальные — по возможности.
- Внедрение зависимостей только через конструктор (`@RequiredArgsConstructor`).
- DTO — `record`. Доменные value objects — `record` или immutable-класс.
- `Optional` — только как возвращаемый тип. Не поле, не параметр.
- Для коллекций возвращать пустую коллекцию, а не `null`.
- Строковые шаблоны — `String.format` или текстовые блоки, не конкатенация в цикле.

## Пример

```java
public record CreatePaymentRequest(
        @NotNull @Positive BigDecimal amount,
        @NotBlank @Size(max = 3) String currency,
        @NotNull UUID orderId
) {}
```

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private static final int MAX_RETRY_COUNT = 3;

    private final PaymentRepository paymentRepository;
    private final PaymentGateway paymentGateway;

    public Payment create(CreatePaymentCommand command) {
        ...
    }
}
```

## Деньги и время

- Деньги — `BigDecimal` + код валюты. Никогда `double`/`float`.
- Момент времени — `Instant`, хранится в UTC. Дата без времени — `LocalDate`.
- Длительность — `Duration`, не `long millis`.

## Lombok

Разрешено: `@RequiredArgsConstructor`, `@Getter`, `@Builder`, `@Slf4j`, `@Value`.
Запрещено: `@Data`, `@Setter` на сущностях, `@SneakyThrows`,
`@EqualsAndHashCode` на JPA-сущностях.

## Нельзя

- `@Autowired` на полях.
- Ловить `Exception` или `Throwable` без переброса.
- Пустой `catch`.
- `System.out.println`, `printStackTrace`.
- Звёздочные импорты.
- Статическое изменяемое состояние.
