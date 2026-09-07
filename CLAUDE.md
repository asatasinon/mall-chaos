# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose and Current Scope

Castrel Chaos is an e-commerce microservices platform for chaos-engineering training. It produces observable behavior through real business HTTP, SQL, Redis, JVM, storage, locking, and PSP paths. It is not a synthetic latency, fake-result, or controller-error simulator.

Treat current code and configuration as the authoritative inputs before changing behavior:

- [traffic-control-plane/src/lib/fault-run-catalog.ts](traffic-control-plane/src/lib/fault-run-catalog.ts) is the machine-readable scenario contract. Do not duplicate mutable catalog facts elsewhere.
- `traffic-control-plane` owns the catalog, run lifecycle, operator audit, and recovery control. Its standalone worker runs customer lifecycle traffic, scenario executors, replenishment, expired-run recovery, retention, and optional data warmup.
- `shopfront -> gateway-service -> business services` is the consumer path. The control plane reaches business operations through Gateway; only data warmup writes its two dedicated history tables directly while holding a Redis lease.
- [README.md](README.md) owns operator/deployer setup. Keep this file focused on maintainer decisions, invariants, and validation.
- Planning and task documents are optional background when present. Do not make root documentation or runtime behavior depend on them.

## Build, Test, and Run

Use JDK 21, Maven 3.8+, Node.js 22, and pnpm 10.27.0. Node 22 matches the control-plane and Shopfront Dockerfiles. Run the following from the repository root unless a command changes directory.

```bash
# Install common and required upstream modules before a targeted Java build.
mvn clean install -pl common -am -DskipTests

# Build all Java services or one service.
mvn clean package -DskipTests
mvn clean package -pl order-service -DskipTests

# Build all Docker images. The default target platform is linux/amd64.
./scripts/build-all.sh

# Start registry images. The helper defaults to the internal image source,
# pulls before starting, and starts detached when no Compose arguments are given.
./scripts/compose-up.sh
./scripts/compose-up.sh -s hub

# Start locally built, unpushed images without pulling remote tags.
docker compose up -d --no-build --pull never --force-recreate
PLATFORM=linux/amd64 ./scripts/build-all.sh -s hub --tag local
REGISTRY=castrel IMAGE_TAG=local docker compose up -d --no-build --pull never --force-recreate

# Build, push, and start a Docker Hub-style image tag.
./scripts/build-all.sh -s hub --tag <tag> --push
IMAGE_TAG=<tag> ./scripts/compose-up.sh -s hub -- --force-recreate

# traffic-control-plane Web/API and worker run as separate processes.
cd traffic-control-plane
pnpm install
pnpm dev                     # Web/API on :13086
pnpm worker                  # runner, scenario workers, recovery, retention, replenishment, warmup
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

`-s hub` selects an image source, not a service. `build-all.sh` pushes only with `--push`; do not use `compose-up.sh` for unpushed local tags because it pulls first. The Web/API needs `CONTROL_PLANE_SESSION_SECRET` or its `CASTREL_JWT_SECRET` fallback. The worker additionally requires `CASTREL_INTERNAL_SERVICE_KEY` and a valid non-empty `TRAFFIC_LIFECYCLE_ACCOUNTS` value.

## Architecture and Ownership

```text
Browser -> shopfront :13090 -> gateway-service :18080 -> business services
Operator -> traffic-control-plane :13086 (Next.js Web/API)
traffic-control-plane-worker -> gateway-service -> fixed business operations
```

`traffic-control-plane` alone owns the catalog, run lifecycle, operator audit, and recovery semantics. The Web/API does not run background jobs. The standalone worker starts the lifecycle runner, report and traffic executors, other scenario workers, coupon/inventory replenishment, expired-run recovery, daily retention, and optional data warmup. `DATA_WARMUP_ENABLED=false` disables only warmup. Stop a source worker with `SIGINT` or `SIGTERM` so it can release leases and controlled resources.

All control-plane business HTTP calls must go through `gateway-service`, which reaches only the fixed operation selected by the catalog. A target service may accept a protected generic `operation` plus opaque `runId`, expiry, idempotency, and fencing context; it must not receive catalog identity or control-plane lifecycle state. Data warmup is the sole database exception: the worker writes the two warmup tables while holding its Redis lease.

## Module: `common`

Package root: `com.castrel.chaos.common`.

Shared components are auto-configured through `ServiceComponentAutoConfiguration`; do not duplicate them in individual services.

| Class | Purpose |
|---|---|
| `ApiResponse<T>` | Uniform response envelope: `code`, `message`, and `data`. |
| `BizException` | Business errors with `errorCode`. |
| `TraceContext` | `traceId` propagation. |
| `DistributedLockService` | Redis-backed distributed locking. |
| `DataAuditService` | JDBC-session-scoped table-lock lifecycle. |
| `LocalQueryCacheManager` | Local query-cache state. |

## Non-Negotiable Runtime Rules

### Realism and catalog

- Every observable effect must come from a real business HTTP, SQL, Redis, JVM, storage, lock, or PSP path. Never use `SLEEP()`, fixed delays, fabricated latency, controller-returned fake failures, random fake results, purpose-built demo responses, or disconnected test endpoints as the effect.
- Every scenario is defined in the catalog, targets one fixed business operation, validates its parameters and `durationSec` server-side, and declares a recovery/cleanup strategy. Do not create a second source of truth.
- Slow SQL must use the real Catalog/Order reports and sustained Gateway requests. Table locking uses a JDBC-session-owned `LOCK TABLES inventories WRITE`; row locking uses a real transaction and `SELECT ... FOR UPDATE`; PSP behavior must pass through the independent PSP HTTP client.
- Do not turn contingent runtime effects into promises. Storage append means run-scoped file growth, not proof of a full disk. Lock waits, deadlocks, OOM, health failures, alerts, and recovery duration depend on the deployed runtime.

### Ownership, terminology, and public contracts

- `traffic-control-plane` is the sole location for Fault Run terms, catalog IDs, display names, and control semantics. The user term `traffic-control-panel` means this directory.
- Outside `traffic-control-plane/**`, including all source-owned `src/**` configuration, use business-semantic names only. Do not use fault-injection/exercise/scenario terminology, catalog IDs, or control-plane display names in routes, endpoints, types, fields, messages, logs, metrics, traces, comments, health responses, or configuration keys.
- A protected `/internal/**` service protocol may carry generic `operation`, opaque `runId`, expiry, idempotency, and fencing context. It must not carry a scenario identity, expose Fault Run field names, or interpret catalog/lifecycle semantics; Gateway keeps it off consumer paths.
- Consumer-facing requests, responses, headers, errors, raw stacks, logs, metrics, and traces must not expose scenario IDs, display names, lifecycle state, `faultRunId`, internal operation headers, or exercise-specific fields. Convert errors to the normal business envelope without raw stacks.
- Before merging a scenario change: validate the catalog, exercise the target business path, inspect visible errors and stacks, review target-side prose for copied display names, and run `./scripts/check-runtime-terminology.sh`. Operator documentation may name scenarios; target-side runtime source may not.

### State, recovery, and request invariants

- Runner configuration updates require `version` for optimistic locking. Inventory reset requires `expectedVersion` and the distributed Redis lock.
- `durationSec` ends a controlled activity or lease; it does not guarantee deletion of every resource artifact. Notification storage growth is cleaned only through the allowed, confirmed run-scoped cleanup. Notification heap retention is explicitly non-releasing.
- Every control-plane business HTTP call goes through `gateway-service`.

## Data Warmup Contract

- The supported tuple is `180` days x `300000` rows/day = `54000000` target rows. The worker validates the tuple; do not change one number in isolation.
- Warmup is a standalone leased mutation loop: one worker holds the Redis lease, renews it with a heartbeat, and stops writing after lease loss. Do not repair it by deleting lease/progress ownership fields or running ad hoc SQL.
- Manual jobs use the protected control-plane API, bounded dates/rows, CSRF, confirmation for cleanup, idempotency, and audit. Cleanup exclusions prevent automatic replenishment from recreating deliberately removed data.
- [infra/mysql/init/05-warmup-partitions.sql](infra/mysql/init/05-warmup-partitions.sql) owns partition initialization. The worker owns compatibility checks, daily rollover, progress updates, and stale manual-job recovery. Change schema and runtime logic together.
- A warmup change also updates `traffic-control-plane/src/lib/env.ts`, `traffic-control-plane/src/worker/data-warmup.ts`, Compose and Kubernetes values, and the relevant design/runbook documentation.

## Java Service Baseline

Every service must include:

```yaml
management:
  endpoints.web.exposure.include: health,info,prometheus
  tracing:
    enabled: true
    sampling.probability: 1.0
logging:
  pattern:
    json: true
```

Profiles: `local` uses localhost connectivity, `docker` uses container networking (Compose and Kubernetes), and `chaos` is legacy compatibility only; it does not gate business endpoints or control-plane behavior.

## Local Environment and Deployment Pitfalls

- `scripts/compose-up.sh` defaults to the internal image source, pulls before starting, starts detached when no `up` arguments are supplied, and auto-includes an available SkyWalking override. After local builds use `docker compose up -d --no-build --pull never`; otherwise the helper can replace unpushed images with remote ones.
- For SkyWalking use `COMPOSE_PROFILES=skywalking TRACING_MODE=both ./scripts/compose-up.sh`. The helper downloads the MySQL connector when the repository override is selected. A manual Compose invocation must ensure that connector JAR already exists; it does not receive the helper's automatic override/download behavior. SkyWalking is Compose-only; Kubernetes deploys the Tempo stack.
- Compose enables the Cloudwise agent by default. On Apple Silicon, Java images target `linux/amd64` and startup can be slow; use `ENABLE_CLOUDWISE_AGENT=false ENABLE_OTEL_AGENT=false` when optional agents delay a local check.
- `./scripts/test-baseline.sh` runs Maven tests, starts/checks local MySQL and Redis, then runs control-plane typecheck/lint and Shopfront typecheck/lint/Playwright. It does not run `test:runner`, `test:runbook`, `test:i18n`, a build, or catalog smoke unless separately requested.
- `./scripts/catalog-product-detail-smoke.sh` requires a running full stack and valid operator credentials. It creates and cleans up a control-plane run, changes Redis state, and sends Gateway traffic; it is not a read-only health probe.
- The uncredentialed health checks are `gateway-service` actuator health and the control-plane root route. `/internal/traffic/runner/status` is an operator-protected endpoint and requires an authenticated session.
- Kubernetes Secret templates intentionally contain development placeholders and do not inject independent operator credentials/session secret by default. Follow [README.md](README.md) before a shared deployment.
- Full environment reset is destructive and separate from control-plane run cleanup. Inspect `scripts/mysql-reset.sh` and the current Compose state before running it.

## Service and Observability Ports

Business services below are container-network-only unless a host port is shown. The complete deployer-facing port map, including exposure guidance, lives in [README.md](README.md).

| Service | Host / container port |
|---|---:|
| gateway-service | `18080` / `8080` |
| user-service | not published / `8081` |
| cart-service | not published / `8091` |
| catalog-service | not published / `8082` |
| inventory-service | not published / `8083` |
| order-service | not published / `8084` |
| payment-service | not published / `8085` |
| psp-simulator | not published / `8092` |
| promotion-service | not published / `8087` |
| risk-service | not published / `8088` |
| fulfillment-service | not published / `8089` |
| notification-service | not published / `8090` |
| notification-restart-broker | not published / `8095` |
| traffic-control-plane | `13086` / `3086` |
| shopfront | `13090` / `3090` |
| MySQL | `13306` / `3306` |
| Redis | `16379` / `6379` |
| Grafana | `13000` / `3000` |

| Observability endpoint | Host port | Access |
|---|---:|---|
| Prometheus / Alertmanager | `19090` / `19093` | `obs-auth-proxy`, Basic Auth `castrel` / `castrel` in the development Compose file. |
| Loki / Tempo HTTP API | `13100` / `13200` | `obs-auth-proxy`, same development Basic Auth. |
| Tempo OTLP gRPC / HTTP ingestion | `14317` / `14318` | No authentication in the current Compose file; restrict outside local use. |
| node / MySQL / Redis exporter | `19100` / `19104` / `19121` | Metrics endpoints. |
| SkyWalking UI / OAP | `13091`, `11800`, `12800` | Optional Compose profile only. |

Java services emit structured JSON logs with `traceId`; Promtail collects them for Loki. Compose enables Grafana anonymous Viewer access and ships development credentials. Never carry those defaults into a shared deployment.

## Validation

Choose the narrowest check that covers the changed behavior, then widen only when the change crosses an ownership boundary.

```bash
# After stack startup: anonymous health checks only.
curl -fsS http://localhost:18080/actuator/health
curl -fsSI http://localhost:13086/

# Focused control-plane changes.
(cd traffic-control-plane && pnpm test:runner && pnpm typecheck && pnpm lint)

# Scenario documentation and localization changes.
(cd traffic-control-plane && pnpm test:runbook && pnpm test:i18n)

# Focused Shopfront changes.
(cd shopfront && pnpm typecheck && pnpm lint && pnpm test:e2e)

# Scenario behavior on a complete, disposable local stack; changes runtime state.
./scripts/catalog-product-detail-smoke.sh

# Cross-service workflow; starts/checks local MySQL and Redis.
./scripts/test-baseline.sh

# Static deployment and source checks.
docker compose config --quiet
kubectl kustomize k8s >/dev/null
./scripts/check-runtime-terminology.sh
git diff --check
```

The terminology script catches explicit injection terms and catalog identifiers in runtime source outside the control plane. It does not replace review of target-side prose, public contracts, exception envelopes, or raw-stack suppression for display-name leakage. Warmup changes need coverage for lease loss, tuple rejection, stale-job recovery, bounds, rollover, and cleanup exclusions; the existing unit suite is not a substitute for that behavior-level verification.

## Current Functionality

- Scenario operations: the control plane manages one catalog-defined run at a time, drives fixed real business/resource paths, records lifecycle/audit evidence, and applies catalog-defined recovery or confirmed cleanup.
- Customer lifecycle: the worker uses configured accounts to maintain normal customer traffic and supports report and traffic execution without exposing control-plane context to consumer requests.
- Data warmup: one worker owns a Redis lease, maintains the supported historical-data target with bounded writes, and stops writing when it loses ownership.
- Observability: Java services emit structured logs with `traceId`; Prometheus, Grafana, Loki and Tempo are provided by the deployment configuration.



