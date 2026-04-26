# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Castrel Chaos is an e-commerce microservices platform purpose-built for **chaos engineering training**. It generates realistic business traffic and supports injecting network faults, JVM memory leaks, slow SQL, and database deadlocks — all observable through a full Prometheus/Grafana/Loki/Tempo stack.

Before implementing any feature, read the relevant task spec in `_docs/tasks/` and check `_docs/tasks/README.md` for the task dependency graph. The canonical architecture and chaos design is in `_docs/plans/chaos-v2.md`.

## Build Commands

```bash
# Install common module first (required before any single-service build)
mvn clean install -pl common -DskipTests

# Build all Java services
mvn clean package -DskipTests

# Build a single service
mvn clean package -pl order-service -DskipTests

# Build all Docker images (also runs Maven internally)
./scripts/build-all.sh

# Start local environment with pre-built images (pulls from registry)
./scripts/compose-up.sh

# Start with locally built images (after build-all.sh)
docker compose up -d --no-build

# traffic-control-plane (Next.js) — local dev only
cd traffic-control-plane
pnpm install
pnpm dev        # Next.js web on :3086
pnpm worker     # Runner worker process
pnpm lint
```

## Architecture

```
Browser → traffic-control-plane :18086 (Next.js UI + Route Handlers)
        → gateway-service :18080

traffic-control-plane → gateway-service → all business services
```

11 Spring Boot modules share a parent POM plus one `common` module. All Chaos control flows through: `traffic-control-plane → gateway-service → target service's /internal/chaos/** endpoints`.

The **gateway-service** never exposes its own chaos endpoints (`chaos.endpoints.enabled=false`). All 8 business services auto-register `ChaosController` via Spring auto-configuration with `matchIfMissing=true`.

## Module: `common`

Package root: `com.castrel.chaos.common`

Shared components auto-configured via `ServiceComponentAutoConfiguration` — **never duplicate these in individual services**:

| Class | Purpose |
|---|---|
| `ApiResponse<T>` | Uniform response envelope (`code`, `message`, `data`) |
| `BizException` | Business errors with `errorCode` |
| `TraceContext` | traceId propagation |
| `DistributedLockService` | Redis-backed distributed lock |
| `QueryEnrichmentInterceptor` | Slow SQL via JOIN on large tables |
| `DataAuditService` | Table-lock injection (`LOCK TABLES ... WRITE`) disguised as data audit |
| `LocalQueryCacheManager` | Memory leak via unbounded cache growth |
| `ChaosService` | Unified chaos control (slow-SQL / memory-leak / deadlock / table-lock) |
| `ChaosController` | `/internal/chaos/**` endpoints registered in all 8 business services |

## Key Conventions

### Chaos Endpoint Rules
- Chaos REST endpoints are always compiled in; gated by `chaos.endpoints.enabled` property
- Every chaos bean must support `enable` flag + `durationSec` auto-disable
- Deadlock injection supports `injectRate`, `scope`, and `durationSec`
- Slow SQL uses JOIN enrichment on large tables (not `SLEEP()`)
- Table lock = `LOCK TABLES <table> WRITE` wrapped in the DataAudit facade

### Critical Invariants
- Runner config updates require a `version` field (optimistic lock protection)
- Inventory reset requires `expectedVersion` + distributed Redis lock
- All chaos beans auto-disable after `durationSec` elapses
- All business HTTP calls from traffic-control-plane must go through gateway-service

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
    json: true   # structured JSON for Loki ingestion
```

### Spring Profiles
- `local` — localhost connectivity
- `docker` — container networking (used in Compose and K8s)
- `chaos` — kept for compatibility; **v2 does not use this to gate chaos endpoints**

## Service Ports (host:container)

| Service | Host Port | Container Port |
|---|---|---|
| gateway-service | 18080 | 8080 |
| user-service | 18081 | 8081 |
| catalog-service | 18082 | 8082 |
| inventory-service | 18083 | 8083 |
| order-service | 18084 | 8084 |
| payment-service | 18085 | 8085 |
| traffic-control-plane | 18086 | 3086 |
| promotion-service | 18087 | 8087 |
| risk-service | 18088 | 8088 |
| fulfillment-service | 18089 | 8089 |
| notification-service | 18090 | 8090 |
| MySQL | 13306 | 3306 |
| Redis | 16379 | 6379 |
| Grafana | 13000 | 3000 |

## Observability

| Service | URL | Credentials |
|---|---|---|
| Grafana | http://localhost:13000 | admin / admin |
| Prometheus | http://localhost:19090 | castrel / castrel (Basic Auth via nginx) |
| Loki | http://localhost:13100 | castrel / castrel |
| Tempo | http://localhost:13200 | castrel / castrel |

All logs are structured JSON with `traceId`, collected by Promtail → Loki.

## Verification

```bash
# Health check after startup
curl http://localhost:18080/actuator/health
curl http://localhost:18086/internal/traffic/runner/status   # should show running=true

# Run the 7-scenario interactive chaos verification
./scripts/chaos/chaos-verify.sh
```

## Docs Reference

| Topic | File |
|---|---|
| Task dependency graph | `_docs/tasks/README.md` |
| Architecture & chaos design (v2) | `_docs/plans/chaos-v2.md` |
| v2 common chaos components | `_docs/tasks/task-14-v2-common-components.md` |
| v2 service integration | `_docs/tasks/task-16-v2-service-integration.md` |
| Gateway chaos dispatch | `_docs/tasks/task-21-gateway-chaos-dispatch.md` |
| Chaos protocol unification | `_docs/tasks/task-22-chaos-protocol-unification.md` |

