# Castrel Chaos — Agent Guidelines

**Castrel Chaos** is an e-commerce microservices platform purpose-built for **chaos engineering training**. It auto-generates realistic traffic and supports injecting network faults, memory leaks, slow SQL, and database deadlocks.

## Project State

Architecture is in [`_docs/plans/chaos-v1.md`](_docs/plans/chaos-v1.md); per-task specs in [`_docs/tasks/`](_docs/tasks/). Before implementing anything, read the relevant task file first.

**Task execution order**: See [`_docs/tasks/README.md`](_docs/tasks/README.md) for the full dependency graph.

## Architecture

- **12 Maven modules**: `common` + 11 Spring Boot microservices
- **Local dev**: Docker Compose
- **Production**: Kubernetes + Chaos Mesh

| Service | Port | Key Role | Chaos Features |
|---|---|---|---|
| gateway-service | 8080 | Routing, traceId injection | — |
| user-service | 8081 | User profiles, addresses | — |
| catalog-service | 8082 | Products, SKUs | Slow SQL |
| inventory-service | 8083 | Reservation, distributed locks | Slow SQL |
| order-service | 8084 | Order orchestration, idempotency | Slow SQL · Memory Leak · Deadlock |
| payment-service | 8085 | Payment simulation (90/5/5%) | Slow SQL · Deadlock |
| traffic-runner-service | 8086 | Auto traffic, hot-reload, inventory reset | — |
| promotion-service | 8087 | Discounts, coupons, Redis cache | Slow SQL |
| risk-service | 8088 | Pre-order + post-pay risk checks | Slow SQL |
| fulfillment-service | 8089 | Fulfillment, async shipping | Slow SQL |
| notification-service | 8090 | Event-driven notifications | Slow SQL |

## Tech Stack

- **Java 21**, **Spring Boot 3.3.x**, **Maven 3.8+**
- **MySQL 8.0** (slow query log enabled), **Redis** (LRU, distributed locking)
- **Observability**: Prometheus · Grafana · Loki · Tempo (OTLP tracing)
- **Chaos infra**: ToxiProxy · Pumba · Chaos Mesh (K8s)

## Build & Run

```bash
# Build all modules (run from project root)
mvn clean package -DskipTests

# Build a single service
mvn clean package -pl order-service -DskipTests

# Start local infra + all services
docker-compose up -d

# Tear down
docker-compose down
```

## Key Conventions

### Spring Profiles
- `local` — default, uses localhost connectivity
- `docker` — container networking (host aliases)
- `chaos` — **only** this profile exposes chaos injection endpoints

### common Module
Shared classes every service depends on (never duplicate these):
- `ApiResponse<T>` — uniform response envelope (`code`, `message`, `data`)
- `BizException` — business errors with `errorCode`
- `TraceContext` — traceId propagation utility
- `ChaosScope` enum — `ALL` | `PARTIAL`
- `DistributedLockService` — Redis-backed distributed lock
- `chaos/SlowSqlChaosService` — slow SQL injection utility (shared across 7 services)
- `chaos/MemoryLeakChaosService` — JVM memory leak injection utility
- `config/ChaosCommonAutoConfiguration` — Spring auto-config for chaos beans
- `config/ChaosJdbcAutoConfiguration` — JDBC datasource chaos wiring
- `config/ChaosRedisAutoConfiguration` — Redis chaos wiring

### Chaos Component Rules (from [`_docs/tasks/task-14-chaos-slow-sql.md`](_docs/tasks/task-14-chaos-slow-sql.md))
- Every chaos bean must support `enable` flag + `durationSec` for auto-disable
- Chaos REST endpoints are **only** exposed under `chaos` Spring profile
- Slow SQL "real" mode: `SELECT SLEEP(N)` inside the transaction
- Deadlock injection: two concurrent transactions with swapped lock order

### Critical Invariants
| Rule | Reference |
|---|---|
| Runner config update must include `version` (optimistic lock) | Task 09 §9.5 |
| Inventory reset requires `expectedVersion` + distributed Redis lock | Task 06 §6.3 |
| All chaos beans must auto-disable after `durationSec` | Task 14 §14.4 |
| `SELECT SLEEP(N)` for realistic slow SQL | Task 14 §14.1 |
| Deadlock = two txns with swapped row-lock order | Task 16 §16.1 |

### application.yml Baseline
Every service must include:
```yaml
management:
  endpoints.web.exposure.include: health,info,prometheus
  tracing:
    enabled: true
    sampling.probability: 1.0
logging:
  pattern:
    json: true  # structured JSON logs for Loki
```

## Docs Reference

| Topic | File |
|---|---|
| Master architecture | [`_docs/plans/chaos-v1.md`](_docs/plans/chaos-v1.md) |
| Task dependency graph | [`_docs/tasks/README.md`](_docs/tasks/README.md) |
| Project scaffold (POM layout) | [`_docs/tasks/task-01-project-scaffold.md`](_docs/tasks/task-01-project-scaffold.md) |
| Docker Compose + infra | [`_docs/tasks/task-02-infra-compose.md`](_docs/tasks/task-02-infra-compose.md) |
| Slow SQL chaos module | [`_docs/tasks/task-14-chaos-slow-sql.md`](_docs/tasks/task-14-chaos-slow-sql.md) |
| Memory leak chaos | [`_docs/tasks/task-15-chaos-memory-leak.md`](_docs/tasks/task-15-chaos-memory-leak.md) |
| Deadlock chaos | [`_docs/tasks/task-16-chaos-deadlock.md`](_docs/tasks/task-16-chaos-deadlock.md) |
| Network fault injection | [`_docs/tasks/task-17-chaos-network.md`](_docs/tasks/task-17-chaos-network.md) |
| Kubernetes deployment | [`_docs/tasks/task-18-kubernetes.md`](_docs/tasks/task-18-kubernetes.md) |
| Chaos verification (7 scenarios) | [`_docs/tasks/task-19-chaos-verification.md`](_docs/tasks/task-19-chaos-verification.md) |
