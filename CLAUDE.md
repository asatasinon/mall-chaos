# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Castrel Chaos is an e-commerce microservices platform purpose-built for **chaos engineering training**. It generates realistic business traffic and supports injecting network faults, JVM memory leaks, slow SQL, and database deadlocks — all observable through a full Prometheus/Alertmanager/Grafana/Loki/Tempo stack.

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
pnpm dev        # Next.js web on :13086
pnpm worker     # Runner worker process
pnpm lint
```

## Architecture

```
Browser → traffic-control-plane :13086 (Next.js UI + Route Handlers)
        → gateway-service :18080

traffic-control-plane → gateway-service → all business services
```

11 Spring Boot modules share a parent POM plus one `common` module. All scenario control flows through `traffic-control-plane → gateway-service → one fixed target operation`.

The **gateway-service** only dispatches catalog-defined scenarios to their fixed target operations. Slow SQL scenarios exercise the public catalog and order report paths through sustained Gateway requests.

## Module: `common`

Package root: `com.castrel.chaos.common`

Shared components auto-configured via `ServiceComponentAutoConfiguration` — **never duplicate these in individual services**:

| Class | Purpose |
|---|---|
| `ApiResponse<T>` | Uniform response envelope (`code`, `message`, `data`) |
| `BizException` | Business errors with `errorCode` |
| `TraceContext` | traceId propagation |
| `DistributedLockService` | Redis-backed distributed lock |
| `DataAuditService` | Table-lock injection (`LOCK TABLES ... WRITE`) disguised as data audit |
| `LocalQueryCacheManager` | Memory leak via unbounded cache growth |

## Key Conventions

### Scenario Rules
- Every scenario is catalog-defined, targets one fixed operation, and carries a server-validated `durationSec`
- Slow SQL uses real catalog/order report SQL and sustained public requests, not auxiliary JOIN injection
- Table locking uses a dedicated Inventory target operation and a JDBC session-owned `LOCK TABLES inventories WRITE`

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

## Service Ports

| Service | Host Port (Compose) | Container Port |
|---|---|---|
| gateway-service | 18080 | 8080 |
| user-service | not published (container network only) | 8081 |
| cart-service | not published (container network only) | 8091 |
| catalog-service | not published (container network only) | 8082 |
| inventory-service | not published (container network only) | 8083 |
| order-service | not published (container network only) | 8084 |
| payment-service | not published (container network only) | 8085 |
| traffic-control-plane | 13086 | 3086 |
| promotion-service | not published (container network only) | 8087 |
| risk-service | not published (container network only) | 8088 |
| fulfillment-service | not published (container network only) | 8089 |
| notification-service | not published (container network only) | 8090 |
| shopfront | 13090 | 3090 |
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
curl http://localhost:13086/internal/traffic/runner/status   # should show running=true

# Run the 7-scenario interactive chaos verification
./scripts/chaos/chaos-verify.sh
```



