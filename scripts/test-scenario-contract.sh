#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_PLANE_ROOT="$REPO_ROOT/traffic-control-plane"
ARTIFACT_ROOT="$REPO_ROOT/tmp/scenario-contract"
SOURCE_COMMIT_SHA=''
CATALOG_REVISION='INVALID'
GLOBAL_FAILURE=0
LAST_STATUS='FAILED'
LAST_EXIT_CODE=1

if command -v git >/dev/null 2>&1; then
  candidate_commit="$(git -C "$REPO_ROOT" rev-parse --verify HEAD 2>/dev/null || true)"
  working_tree_status="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all 2>/dev/null || true)"
  if [[ "$candidate_commit" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ && -z "$working_tree_status" ]]; then
    SOURCE_COMMIT_SHA="$candidate_commit"
  else
    GLOBAL_FAILURE=1
  fi
else
  GLOBAL_FAILURE=1
fi

RUN_SUFFIX="${SOURCE_COMMIT_SHA:-unknown}-$$"
RUN_DIR="$ARTIFACT_ROOT/run-$RUN_SUFFIX"
CHECKS_DIR="$RUN_DIR/checks"
STEPS_DIR="$RUN_DIR/steps"
GATEWAY_EXPECTATION="$RUN_DIR/scenario-contract-gateway.json"
MANIFEST_FILE="$RUN_DIR/scenario-contract-manifest.json"

if ! mkdir -p "$CHECKS_DIR" "$STEPS_DIR"; then
  printf 'test-scenario-contract: could not create artifact directory\n' >&2
  exit 1
fi
cd "$REPO_ROOT"

run_command() {
  if "$@"; then
    LAST_STATUS='PASSED'
    LAST_EXIT_CODE=0
  else
    LAST_EXIT_CODE=$?
    LAST_STATUS='FAILED'
    GLOBAL_FAILURE=1
  fi
}

write_step_result() {
  local step_id="$1"
  local status="$2"
  local exit_code="$3"
  local commit_json='null'
  local revision="$CATALOG_REVISION"
  if [[ -n "$SOURCE_COMMIT_SHA" ]]; then
    commit_json="\"$SOURCE_COMMIT_SHA\""
  fi
  if [[ "$revision" != 'INVALID' && ! "$revision" =~ ^[a-f0-9]{64}$ ]]; then
    revision='INVALID'
  fi
  if ! printf '{"schemaVersion":"scenario-contract-step-result.v1","stepId":"%s","status":"%s","exitCode":%s,"catalogRevision":"%s","sourceCommitSha":%s}\n' \
    "$step_id" "$status" "$exit_code" "$revision" "$commit_json" \
    > "$STEPS_DIR/$step_id.json"; then
    GLOBAL_FAILURE=1
  fi
}

write_check_result() {
  local check_id="$1"
  local status="$2"
  local file_name="$check_id.json"
  local commit_json='null'
  local revision="$CATALOG_REVISION"
  if [[ "$check_id" == 'gateway-service.operation-dispatch' ]]; then
    file_name='gateway-operation-dispatch.json'
  fi
  if [[ -n "$SOURCE_COMMIT_SHA" ]]; then
    commit_json="\"$SOURCE_COMMIT_SHA\""
  fi
  if [[ "$revision" != 'INVALID' && ! "$revision" =~ ^[a-f0-9]{64}$ ]]; then
    revision='INVALID'
  fi
  if ! printf '{"schemaVersion":"scenario-contract-check-result.v1","checkId":"%s","status":"%s","catalogRevision":"%s","sourceCommitSha":%s}\n' \
    "$check_id" "$status" "$revision" "$commit_json" \
    > "$CHECKS_DIR/$file_name"; then
    GLOBAL_FAILURE=1
  fi
}

run_step() {
  local step_id="$1"
  shift
  run_command "$@"
  write_step_result "$step_id" "$LAST_STATUS" "$LAST_EXIT_CODE"
}

run_check() {
  local check_id="$1"
  shift
  run_command "$@"
  write_check_result "$check_id" "$LAST_STATUS"
  write_step_result "$check_id" "$LAST_STATUS" "$LAST_EXIT_CODE"
}

if [[ -n "$SOURCE_COMMIT_SHA" ]]; then
  write_step_result 'source-commit' 'PASSED' 0
else
  write_step_result 'source-commit' 'FAILED' 1
fi

PREFLIGHT_ARGS=(--out "$RUN_DIR")
if [[ -n "$SOURCE_COMMIT_SHA" ]]; then
  PREFLIGHT_ARGS+=(--source-commit-sha "$SOURCE_COMMIT_SHA")
fi
run_step 'preflight' pnpm --dir "$CONTROL_PLANE_ROOT" validate:contract:preflight -- \
  "${PREFLIGHT_ARGS[@]}"

if [[ -s "$MANIFEST_FILE" ]] && command -v node >/dev/null 2>&1; then
  extracted_revision="$(node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).catalogRevision;
    if (typeof value !== "string") process.exit(2);
    process.stdout.write(value);
  ' "$MANIFEST_FILE" 2>/dev/null || true)"
  if [[ "$extracted_revision" =~ ^[a-f0-9]{64}$ ]]; then
    CATALOG_REVISION="$extracted_revision"
  else
    GLOBAL_FAILURE=1
  fi
else
  GLOBAL_FAILURE=1
fi

run_check 'traffic-control-plane.contract-tests' \
  pnpm --dir "$CONTROL_PLANE_ROOT" test:contract
run_check 'traffic-control-plane.runbook' \
  pnpm --dir "$CONTROL_PLANE_ROOT" test:runbook
run_check 'traffic-control-plane.i18n' \
  pnpm --dir "$CONTROL_PLANE_ROOT" test:i18n
run_check 'traffic-control-plane.terminology' \
  bash "$REPO_ROOT/scripts/check-runtime-terminology.sh"
run_check 'traffic-control-plane.typecheck' \
  pnpm --dir "$CONTROL_PLANE_ROOT" typecheck
run_check 'traffic-control-plane.lint' \
  pnpm --dir "$CONTROL_PLANE_ROOT" lint

run_step 'java-target-contracts' mvn -B -fae \
  -pl gateway-service,catalog-service,order-service,notification-service,promotion-service,inventory-service,psp-simulator \
  -am \
  -Dtest=OperationDispatchContractTest,OperationTargetRegistryTest,CatalogOperationsControllerTest,OrderReportOperationsControllerContractTest,NotificationOperationControllerContractTest,CouponReservationConsistencyControllerContractTest,InventoryOperationsControllerContractTest,PspControllerContractTest \
  -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dscenario.contract.expected=$GATEWAY_EXPECTATION" \
  "-Dscenario.contract.checksDir=$CHECKS_DIR" \
  "-Dscenario.contract.sourceCommitSha=$SOURCE_COMMIT_SHA" \
  test
JAVA_STATUS="$LAST_STATUS"

ensure_java_result() {
  local check_id="$1"
  local file_name="$check_id.json"
  if [[ "$check_id" == 'gateway-service.operation-dispatch' ]]; then
    file_name='gateway-operation-dispatch.json'
  fi
  if [[ "$JAVA_STATUS" == 'FAILED' || ! -s "$CHECKS_DIR/$file_name" ]]; then
    GLOBAL_FAILURE=1
    write_check_result "$check_id" 'FAILED'
    write_step_result "$check_id-result" 'FAILED' 1
  fi
}

ensure_java_result 'gateway-service.operation-dispatch'
ensure_java_result 'catalog-service.scenario-targets'
ensure_java_result 'order-service.scenario-targets'
ensure_java_result 'notification-service.scenario-targets'
ensure_java_result 'promotion-service.scenario-targets'
ensure_java_result 'inventory-service.scenario-targets'
ensure_java_result 'psp-simulator.scenario-targets'

FINALIZE_ARGS=(--checks "$CHECKS_DIR" --scope STATIC_CONTRACT --out "$RUN_DIR")
if [[ -n "$SOURCE_COMMIT_SHA" ]]; then
  FINALIZE_ARGS+=(--source-commit-sha "$SOURCE_COMMIT_SHA")
fi
run_step 'finalize' pnpm --dir "$CONTROL_PLANE_ROOT" validate:contract:finalize -- \
  "${FINALIZE_ARGS[@]}"

printf 'Scenario Contract artifacts: %s\n' "${RUN_DIR#"$REPO_ROOT"/}"
if [[ "$GLOBAL_FAILURE" -ne 0 ]]; then
  exit 1
fi
exit 0
