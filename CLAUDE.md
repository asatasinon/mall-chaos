# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Castrel Chaos is an e-commerce microservices platform purpose-built for **chaos engineering training**. It drives real business HTTP, SQL, Redis, JVM, storage, locking, and PSP behavior through a full Prometheus/Alertmanager/Grafana/Loki/Tempo stack; it is not a synthetic latency or error-response simulator.

Before implementing a feature, read `product.md`, `technical-design.md` (when present), and `task-list.md` in the relevant `docs/<area>/` directory; follow the task list's dependency section. The control-plane baseline is [docs/chaos-inject-plane/product.md](docs/chaos-inject-plane/product.md), [docs/chaos-inject-plane/tech.md](docs/chaos-inject-plane/tech.md), and [docs/chaos-inject-plane/task-list.md](docs/chaos-inject-plane/task-list.md). Link to existing documentation instead of duplicating its details in code or new instructions.

## Build Commands

```bash
# Install common and required upstream modules first (required before a targeted service build)
mvn clean install -pl common -am -DskipTests

# Build all Java services
mvn clean package -DskipTests

# Build a single service
mvn clean package -pl order-service -DskipTests

# Build all Docker images (also runs Maven internally)
./scripts/build-all.sh

# Start local environment with pre-built images (pulls from registry)
./scripts/compose-up.sh

# Start with locally built images (after build-all.sh)
docker compose up -d --no-build --pull never --force-recreate

# Build and run local Docker Hub-style tags without pulling remote images
./scripts/build-all.sh -s hub 
REGISTRY=castrel docker compose up -d --no-build --pull never --force-recreate

# Build, push, and start a Docker Hub tag
./scripts/build-all.sh -s hub --tag <tag> --push
IMAGE_TAG=<tag> ./scripts/compose-up.sh -s hub -- --force-recreate

# Note: -s hub selects the image source; it does not select a service. build-all.sh
# builds all images, and images are only uploaded when --push is provided. The
# compose-up.sh helper pulls before starting, so use plain docker compose for
# unpushed local images.

# traffic-control-plane (Next.js)
cd traffic-control-plane
pnpm install                 # pnpm@10.27.0
pnpm dev                     # Next.js web on :13086
pnpm worker                  # runner, scenario workers, schedulers, and optional data warmup
pnpm test:runner
pnpm test:runbook
pnpm test:i18n
pnpm typecheck
pnpm lint
pnpm build

# shopfront
cd ../shopfront
pnpm install
pnpm typecheck
pnpm lint
pnpm test:e2e
```

## Architecture

```
Browser → traffic-control-plane :13086 (Next.js UI + Route Handlers)
        → gateway-service :18080

traffic-control-plane → gateway-service → all business services
```

The Spring Boot services share a parent POM plus one `common` module. All scenario control flows through `traffic-control-plane → gateway-service → one fixed target operation`.

Only `traffic-control-plane` owns the catalog, run lifecycle, operator audit, and recovery semantics. The **gateway-service** reaches only the fixed business operations selected by that control plane; Gateway and target services must not expose catalog or run terminology. Slow SQL runs exercise the public catalog and order report paths through sustained Gateway requests.

The standalone control-plane worker requires `CASTREL_INTERNAL_SERVICE_KEY` and starts the runner, recovery/retention jobs, replenishment schedulers, scenario workers, and data warmup. `DATA_WARMUP_ENABLED=false` disables only data warmup. It does not stop the other worker responsibilities. Worker shutdown must go through SIGINT/SIGTERM so leases and controlled resources are released.

## Module: `common`

Package root: `com.castrel.chaos.common`

Shared components auto-configured via `ServiceComponentAutoConfiguration` — **never duplicate these in individual services**:

| Class | Purpose |
|---|---|
| `ApiResponse<T>` | Uniform response envelope (`code`, `message`, `data`) |
| `BizException` | Business errors with `errorCode` |
| `TraceContext` | traceId propagation |
| `DistributedLockService` | Redis-backed distributed lock |
| `DataAuditService` | JDBC-session-scoped table-lock lifecycle |
| `LocalQueryCacheManager` | Local query-cache state |

## Key Conventions

### Realism, Catalog, and Exposure Rules
- Every scenario is catalog-defined, targets one fixed operation, and carries a server-validated `durationSec`
- Every observable effect must arise from a real business HTTP, SQL, Redis, JVM, storage, lock, or PSP path. Do not use `SLEEP()`, fabricated latency, controller-returned fake failures, random fake results, or purpose-built demo responses as the effect.
- Slow SQL uses real catalog/order report SQL and sustained public requests, not auxiliary JOIN injection. Table locking uses a dedicated Inventory operation and a JDBC session-owned `LOCK TABLES inventories WRITE`.
- `traffic-control-plane` is the repository's control panel and the sole location allowed to use Fault Run terminology, catalog scenario IDs, scenario display names, or descriptions of fault injection/exercises.
- Outside `traffic-control-plane`, runtime source must not use those terms in routes, Endpoint names, controllers, classes, methods, DTOs, parameter names, error codes/messages, exception types/messages, logs, metric labels, trace attributes, comments, or configuration keys. Keep target-side names and behaviors business-semantic.
- Do not expose a scenario ID, control-plane lifecycle state, or an exercise-specific field in consumer-facing requests, responses, headers, errors, logs, metrics, or traces. When internal correlation is necessary, use opaque technical context with no exercise semantics.
- Client error handling must return the normal business envelope without raw stacks. Exception classes, methods, and messages outside the control plane must remain business-named so a user cannot infer an injected condition from an interface, error detail, or stack trace.

### Critical Invariants
- Runner config updates require a `version` field (optimistic lock protection)
- Inventory reset requires `expectedVersion` + distributed Redis lock
- All target-side controlled resources expire or stop after `durationSec`; notification heap retention is the documented non-releasing exception
- All business HTTP calls from traffic-control-plane must go through gateway-service

### Data Warmup
- The current supported configuration is `180` days × `300000` rows/day = `54000000` target rows. The worker validates this tuple; do not change one value in isolation.
- Warmup is a standalone leased mutation loop: one worker owns the Redis lease at a time, renews it with a heartbeat, and stops writes after lease loss. Do not repair it by deleting lease/progress ownership fields or by issuing ad hoc SQL.
- Manual warmup operations use the protected control-plane jobs API, bounded dates/rows, CSRF, confirmation for cleanup, idempotency, and audit. Cleanup exclusions prevent automatic replenishment from recreating manually removed data.
- Partition initialization is owned by [infra/mysql/init/05-warmup-partitions.sql](infra/mysql/init/05-warmup-partitions.sql); the worker performs compatibility checks, daily rollover, progress updates, and stale manual-job recovery. Change schema and runtime logic together.
- If warmup behavior changes, update `traffic-control-plane/src/lib/env.ts`, `traffic-control-plane/src/worker/data-warmup.ts`, Compose/Kubernetes values, and the relevant design/runbook documentation together.

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

### Local Environment Pitfalls
- `scripts/compose-up.sh` pulls images before starting and defaults to the internal registry. After local builds, use `docker compose up -d --no-build --pull never` or explicitly override the image source.
- On Apple Silicon, Java images target `linux/amd64`; local startup can be slow. Disable optional Cloudwise/OTel agents with `ENABLE_CLOUDWISE_AGENT=false ENABLE_OTEL_AGENT=false` when verifying locally if those agents delay startup.
- Full baseline verification starts infrastructure and can modify local MySQL/Redis state. Treat `scripts/test-baseline.sh` as an environment-affecting workflow, not a read-only test.
- Full environment reset is destructive and is separate from control-plane run cleanup. Follow [docs/runbooks/environment-reset.md](docs/runbooks/environment-reset.md).

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

# Run the maintained catalog product-detail smoke test
./scripts/catalog-product-detail-smoke.sh

# Run the maintained full verification workflow (starts infrastructure)
./scripts/test-baseline.sh

# Validate configuration and manifests without starting the stack
docker compose config --quiet
kubectl kustomize k8s >/dev/null
git diff --check

# Verify that runtime source outside the control plane does not leak catalog terminology
if rg -n -i --glob '!**/target/**' --glob '!traffic-control-plane/**' --glob '**/src/**' \
  '故障注入|故障演练|故障场景|fault[ -]?injection|fault[ -]?exercise|chaos[ -]?scenario|fault[ -]?run|faultRunId|BROWSE_REPORT_SQL|ORDER_REPORT_SQL|BROWSE_SURGE|ORDER_QUERY_SURGE|CATALOG_REDIS_LARGE_VALUE|CART_CATALOG_DEPENDENCY|NOTIFICATION_HEAP_PRESSURE|NOTIFICATION_STORAGE_APPEND|PROMOTION_LOCK_CONTENTION|INVENTORY_TABLE_EXCLUSIVE|INVENTORY_ROW_LOCK|PSP_PROVIDER_OUTCOME' .; then
  echo 'Control-plane terminology leaked into runtime source.' >&2
  exit 1
fi
```

For a focused control-plane change, run `cd traffic-control-plane && pnpm test:runner && pnpm typecheck && pnpm lint`; for a focused shopfront change, run its typecheck, lint, and relevant Playwright test. Warmup changes currently have limited unit coverage, so add or run integration coverage for lease loss, configuration rejection, stale-job recovery, bounds, rollover, and cleanup exclusions.

## Documentation Map

- Product and acceptance scope: [docs/chaos-inject-plane/product.md](docs/chaos-inject-plane/product.md)
- Control-plane design and contracts: [docs/chaos-inject-plane/tech.md](docs/chaos-inject-plane/tech.md)
- Current implementation sequence and dependencies: [docs/chaos-inject-plane/task-list.md](docs/chaos-inject-plane/task-list.md)
- Service topology: [docs/microservice-topology.md](docs/microservice-topology.md)
- Architecture overview: [docs/architecture.md](docs/architecture.md)
- Environment reset: [docs/runbooks/environment-reset.md](docs/runbooks/environment-reset.md)



