# Castrel Chaos — Agent Guidelines

**Castrel Chaos** is an e-commerce microservices platform purpose-built for **chaos engineering training**. It auto-generates realistic traffic and supports injecting network faults, memory leaks, slow SQL, and database deadlocks.

## Project State

Current architecture and chaos design: [`_docs/plans/chaos-v2.md`](_docs/plans/chaos-v2.md); per-task specs in [`_docs/tasks/`](_docs/tasks/). Before implementing anything, read the relevant task file first.

**Task execution order**: See [`_docs/tasks/README.md`](_docs/tasks/README.md) for the full dependency graph.

## Architecture

- **12 Maven modules**: `common` + 11 Spring Boot microservices
- **1 Next.js app**: `traffic-control-plane` (local port 13086, container port 3086) — runner + chaos console
- **Local dev**: Docker Compose
- **Production**: Kubernetes + Chaos Mesh

| Service | Port | Key Role | Chaos Features |
|---|---|---|---|
| gateway-service | 8080 | Routing, traceId injection, chaos dispatch | — |
| user-service | 8081 | User profiles, addresses | — |
| catalog-service | 8082 | Products, SKUs | Slow SQL · Memory Leak |
| inventory-service | 8083 | Reservation, distributed locks | Slow SQL · Memory Leak · Table Lock |
| order-service | 8084 | Order orchestration, idempotency | Slow SQL · Memory Leak · Table Lock |
| payment-service | 8085 | Payment simulation (90/5/5%) | Slow SQL · Memory Leak · Table Lock |
| promotion-service | 8087 | Discounts, coupons, Redis cache | Slow SQL · Memory Leak |
| risk-service | 8088 | Pre-order + post-pay risk checks | Slow SQL · Memory Leak · Table Lock |
| fulfillment-service | 8089 | Fulfillment, async shipping | Slow SQL · Memory Leak · Table Lock |
| notification-service | 8090 | Event-driven notifications | Slow SQL · Memory Leak · Table Lock |
| traffic-control-plane | 3086 | Next.js runner + chaos console (Phase 3.5) | — |

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

> **Note**: v2 drops the `chaos` Spring profile. Chaos endpoints are now always present and gated by the `chaos.endpoints.enabled` property (`false` on gateway, `true` on business services).

### common Module
Shared classes every service depends on (never duplicate these):
- `ApiResponse<T>` — uniform response envelope (`code`, `message`, `data`)
- `BizException` — business errors with `errorCode`
- `TraceContext` — traceId propagation utility
- `DistributedLockService` — Redis-backed distributed lock
- `interceptor/QueryEnrichmentInterceptor` — slow SQL injection via large-table JOIN
- `DataAuditService` — table-lock injection disguised as data audit
- `LocalQueryCacheManager` — memory leak injection via unbounded cache
- `chaos/ChaosService` — unified slow-sql / memory-leak / deadlock / table-lock control (Task 22)
- `chaos/ChaosController` — `/internal/chaos/**` endpoints; all 8 business services auto-register this
- `config/ServiceComponentAutoConfiguration` — Spring auto-config for shared service components

### Chaos Component Rules (from [`_docs/tasks/task-14-v2-common-components.md`](_docs/tasks/task-14-v2-common-components.md))
- Every chaos bean must support `enable` flag + `durationSec` for auto-disable
- Chaos REST endpoints are always present; enabled via `chaos.endpoints.enabled` property (`false` on gateway, `true` on business services)
- Slow SQL is driven by JOIN enrichment on large tables
- Deadlock injection must support `injectRate`, `scope`, and `durationSec`

### Critical Invariants
| Rule | Reference |
|---|---|
| Runner config update must include `version` (optimistic lock) | Task 09 §9.5 |
| Inventory reset requires `expectedVersion` + distributed Redis lock | Task 06 §6.3 |
| All chaos beans must auto-disable after `durationSec` | Task 22 |
| Slow SQL uses JOIN enrichment and status introspection | Task 22 |
| Table lock = `LOCK TABLES <table> WRITE` disguised as data audit | Task 16 §16.2 |

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
| Architecture and chaos design | [`_docs/plans/chaos-v2.md`](_docs/plans/chaos-v2.md) |
| Task dependency graph | [`_docs/tasks/README.md`](_docs/tasks/README.md) |
| Project scaffold (POM layout) | [`_docs/tasks/task-01-project-scaffold.md`](_docs/tasks/task-01-project-scaffold.md) |
| Docker Compose + infra | [`_docs/tasks/task-02-infra-compose.md`](_docs/tasks/task-02-infra-compose.md) |
| v2 common chaos components | [`_docs/tasks/task-14-v2-common-components.md`](_docs/tasks/task-14-v2-common-components.md) |
| v2 large-table data warmup | [`_docs/tasks/task-15-v2-data-warmup.md`](_docs/tasks/task-15-v2-data-warmup.md) |
| v2 service integration (table lock · slow SQL · memory leak) | [`_docs/tasks/task-16-v2-service-integration.md`](_docs/tasks/task-16-v2-service-integration.md) |
| Network fault injection | [`_docs/tasks/task-17-chaos-network.md`](_docs/tasks/task-17-chaos-network.md) |
| Kubernetes deployment | [`_docs/tasks/task-18-kubernetes.md`](_docs/tasks/task-18-kubernetes.md) |
| Chaos verification (7 scenarios) | [`_docs/tasks/task-19-chaos-verification.md`](_docs/tasks/task-19-chaos-verification.md) |
| traffic-control-plane scaffold (Next.js) | [`_docs/tasks/task-20-traffic-control-plane-scaffold.md`](_docs/tasks/task-20-traffic-control-plane-scaffold.md) |
| gateway chaos dispatch | [`_docs/tasks/task-21-gateway-chaos-dispatch.md`](_docs/tasks/task-21-gateway-chaos-dispatch.md) |
| chaos protocol unification | [`_docs/tasks/task-22-chaos-protocol-unification.md`](_docs/tasks/task-22-chaos-protocol-unification.md) |
| traffic console & scenario orchestration | [`_docs/tasks/task-23-traffic-console-and-scenarios.md`](_docs/tasks/task-23-traffic-console-and-scenarios.md) |
