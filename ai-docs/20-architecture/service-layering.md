---
id: arch-layering
title: Слои внутри сервиса
type: architecture
scope: [backend, java, spring]
tags: [layers, packages, hexagonal, structure]
status: active
owner: architecture-chapter
updated: 2026-10-01
---

# Слои внутри сервиса

## Структура пакетов

```
ru.company.payment
├── api            // входящие адаптеры: REST-контроллеры, Kafka-листенеры
│   ├── rest
│   │   ├── PaymentController.java
│   │   └── dto/           // только транспортные DTO
│   └── kafka
├── domain         // ядро: сущности, value objects, доменные сервисы
│   ├── model
│   ├── service
│   └── port       // интерфейсы, которые нужны домену (исходящие)
├── infrastructure // реализации портов: JPA, HTTP-клиенты, продюсеры
│   ├── persistence
│   ├── client
│   └── messaging
└── config         // @Configuration, свойства
```

## Правила зависимостей

```
api ──► domain ◄── infrastructure
            ▲
          config
```

- `domain` не зависит ни от Spring Web, ни от JPA, ни от Kafka.
- `api` не обращается к `infrastructure` напрямую — только через `domain`.
- Сущность JPA не покидает `infrastructure`; наружу идёт доменная модель, а в
  `api` — DTO.

## Маппинг

Три модели — DTO, доменная модель, JPA-сущность — и явные мапперы между ними.
Маппер — обычный класс или MapStruct; рефлексивное копирование полей запрещено.

## Пример

```java
// api/rest/PaymentController.java
@RestController
@RequestMapping("/api/v1/payments")
@RequiredArgsConstructor
class PaymentController {

    private final PaymentService paymentService;   // domain.service

    @PostMapping
    ResponseEntity<PaymentResponse> create(@Valid @RequestBody CreatePaymentRequest request) {
        Payment payment = paymentService.create(PaymentMapper.toCommand(request));
        return ResponseEntity.status(HttpStatus.CREATED).body(PaymentMapper.toResponse(payment));
    }
}
```

```java
// domain/port/PaymentRepository.java — порт, реализуется в infrastructure
public interface PaymentRepository {
    Optional<Payment> findById(PaymentId id);
    Payment save(Payment payment);
}
```

## Нельзя

- `@Autowired` на поля — только конструктор.
- JPA-сущность в сигнатуре контроллера.
- `@Transactional` на контроллере.
- Бизнес-правила в мапперах.
