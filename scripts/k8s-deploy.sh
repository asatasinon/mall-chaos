#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_DIR="$REPO_ROOT/k8s"
STAGE="${1:-}"
DRY_RUN=0
CONTROL_PLANE_IMAGE=''
RELEASE_ID=''
RESET_RECORD=''
APPLICATION_MANIFESTS_DIR=''
RENDER_DIR=''
STAGE_RECORD_DIR=''
FINAL_REPORT=''
RELEASE_ATTESTATION=''

usage() {
  printf 'Usage: %s <bootstrap|migrate|verify|application> [--dry-run] [--control-plane-image <name@sha256:digest>] [--release-id <id>] [--reset-record <path>] [--stage-record-dir <dir>] [--application-manifests <dir>] [--final-report <path>] [--release-attestation <path>]\n' "$0" >&2
  exit 2
}

fail() {
  printf 'k8s-deploy: %s\n' "$1" >&2
  exit 1
}

cleanup_render_dir() {
  case "$RENDER_DIR" in
    "$REPO_ROOT"/tmp/k8s-stage.*) rm -rf -- "$RENDER_DIR" ;;
  esac
}

render_job() {
  local template_path="$1"
  local output_name="$2"
  local output_path="$RENDER_DIR/$output_name"
  sed \
    -e "s|__CONTROL_PLANE_IMAGE__|$CONTROL_PLANE_IMAGE|g" \
    -e "s|__RELEASE_ID__|$RELEASE_ID|g" \
    "$template_path" > "$output_path"
  if grep -Fq '__CONTROL_PLANE_IMAGE__' "$output_path" \
    || grep -Fq '__RELEASE_ID__' "$output_path"; then
    fail 'KUBERNETES_JOB_TEMPLATE_UNRESOLVED'
  fi
  printf '%s\n' "$output_path"
}

init_stage_record_dir() {
  if [[ -z "$STAGE_RECORD_DIR" ]]; then
    STAGE_RECORD_DIR="$REPO_ROOT/tmp/k8s-rollout/$RELEASE_ID"
  fi
  if [[ "$STAGE_RECORD_DIR" != /* ]]; then
    STAGE_RECORD_DIR="$REPO_ROOT/$STAGE_RECORD_DIR"
  fi
  mkdir -p "$STAGE_RECORD_DIR"
}

reset_record_checksum() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$RESET_RECORD" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$RESET_RECORD" | awk '{print $1}'
  else
    fail 'SHA256_TOOL_REQUIRED'
  fi
}

require_reset_record() {
  [[ -n "$RESET_RECORD" && -s "$RESET_RECORD" ]] || fail 'CLEAN_SLATE_RESET_RECORD_REQUIRED'
  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    fail 'SHA256_TOOL_REQUIRED'
  fi
}

write_stage_record() {
  local name="$1"
  local value="$2"
  printf '%s\n' "$value" > "$STAGE_RECORD_DIR/$name"
}

read_stage_record() {
  local name="$1"
  local record_path="$STAGE_RECORD_DIR/$name"
  [[ -s "$record_path" ]] || fail 'KUBERNETES_RELEASE_STAGE_RECORD_MISSING'
  tr -d '\r\n' < "$record_path"
}

assert_stage_context() {
  local expected_reset_checksum="$1"
  local recorded_release
  local recorded_image
  local recorded_reset_checksum
  recorded_release="$(read_stage_record release-id)"
  recorded_image="$(read_stage_record control-plane-image)"
  recorded_reset_checksum="$(read_stage_record reset-record-sha256)"
  [[ "$recorded_release" == "$RELEASE_ID" ]] || fail 'KUBERNETES_RELEASE_ID_MISMATCH'
  [[ "$recorded_image" == "$CONTROL_PLANE_IMAGE" ]] || fail 'KUBERNETES_JOB_IMAGE_MISMATCH'
  [[ "$recorded_reset_checksum" == "$expected_reset_checksum" ]] \
    || fail 'CLEAN_SLATE_RESET_RECORD_MISMATCH'
}

require_release_inputs() {
  local image_name="${CONTROL_PLANE_IMAGE%@sha256:*}"
  local image_digest="${CONTROL_PLANE_IMAGE##*@sha256:}"
  if [[ ! "$image_name" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ \
      || ! "$image_digest" =~ ^[a-f0-9]{64}$ \
      || "$CONTROL_PLANE_IMAGE" == *[[:space:]]* ]]; then
    fail 'CONTROL_PLANE_IMAGE_DIGEST_REQUIRED'
  fi
  if [[ ! "$RELEASE_ID" =~ ^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$ ]]; then
    fail 'KUBERNETES_RELEASE_ID_INVALID'
  fi
}

wait_for_database_dependencies() {
  kubectl wait --namespace castrel \
    --for=condition=ready pod \
    --selector=app=mysql \
    --timeout=120s
  kubectl wait --namespace castrel \
    --for=condition=ready pod \
    --selector=app=redis \
    --timeout=60s
}

wait_for_job() {
  local job_name="$1"
  kubectl --namespace castrel wait \
    --for=condition=complete \
    "job/$job_name" \
    --timeout=600s
}

assert_job_image() {
  local job_name="$1"
  local actual_image
  actual_image="$(kubectl --namespace castrel get "job/$job_name" \
    -o 'jsonpath={.spec.template.spec.containers[0].image}')"
  if [[ "$actual_image" != "$CONTROL_PLANE_IMAGE" ]]; then
    fail 'KUBERNETES_JOB_IMAGE_MISMATCH'
  fi
}

job_uid() {
  local job_name="$1"
  local uid
  uid="$(kubectl --namespace castrel get "job/$job_name" \
    -o 'jsonpath={.metadata.uid}')"
  [[ -n "$uid" ]] || fail 'KUBERNETES_JOB_UID_MISSING'
  printf '%s' "$uid"
}

assert_job_record() {
  local job_name="$1"
  local receipt_name="$2"
  local recorded_uid
  local actual_uid
  assert_job_image "$job_name"
  recorded_uid="$(read_stage_record "$receipt_name")"
  actual_uid="$(job_uid "$job_name")"
  [[ "$recorded_uid" == "$actual_uid" ]] || fail 'KUBERNETES_JOB_RECEIPT_MISMATCH'
}

create_job() {
  local file_path="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    kubectl create --dry-run=client -f "$file_path"
  else
    kubectl create -f "$file_path"
  fi
}

apply_application_resources() {
  local application_manifests="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    kubectl apply --dry-run=client -f "$application_manifests/services/" --recursive
    kubectl apply --dry-run=client -f "$application_manifests/ingress/"
  else
    kubectl apply -f "$application_manifests/services/" --recursive
    kubectl apply -f "$application_manifests/ingress/"
  fi
}

manifest_image() {
  local manifest="$1"
  local image_line
  image_line="$(grep -E '^[[:space:]]*image:' "$manifest" | head -n 1 || true)"
  if [[ -z "$image_line" ]]; then
    fail 'APPLICATION_IMAGE_MISSING'
  fi
  printf '%s\n' "$image_line" | sed -E 's/^[[:space:]]*image:[[:space:]]*([^[:space:]]+).*$/\1/'
}

validate_application_manifests() {
  local application_manifests="$1"
  local manifest
  local image_line
  local image_ref
  local image_count=0
  [[ -d "$application_manifests/services" && -d "$application_manifests/ingress" ]] \
    || fail 'APPLICATION_MANIFEST_SET_REQUIRED'
  while IFS= read -r manifest; do
    while IFS= read -r image_line; do
      image_ref="$(printf '%s\n' "$image_line" \
        | sed -E 's/^[[:space:]]*image:[[:space:]]*([^[:space:]]+).*$/\1/')"
      if [[ ! "$image_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
        fail 'APPLICATION_IMAGE_DIGEST_REQUIRED'
      fi
      image_count=$((image_count + 1))
    done < <(grep -E '^[[:space:]]*image:' "$manifest" || true)
  done < <(find "$application_manifests/services" -type f \( -name '*.yaml' -o -name '*.yml' \) | sort)
  [[ "$image_count" -gt 0 ]] || fail 'APPLICATION_IMAGES_REQUIRED'
  [[ "$(manifest_image "$application_manifests/services/traffic-control-plane/deployment.yaml")" \
      == "$CONTROL_PLANE_IMAGE" ]] || fail 'WEB_IMAGE_DIGEST_MISMATCH'
  [[ "$(manifest_image "$application_manifests/services/traffic-control-plane/worker-deployment.yaml")" \
      == "$CONTROL_PLANE_IMAGE" ]] || fail 'WORKER_IMAGE_DIGEST_MISMATCH'
}

if [[ -z "$STAGE" ]]; then usage; fi
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --control-plane-image)
      [[ "$#" -ge 2 ]] || usage
      CONTROL_PLANE_IMAGE="$2"
      shift 2
      ;;
    --release-id)
      [[ "$#" -ge 2 ]] || usage
      RELEASE_ID="$2"
      shift 2
      ;;
    --reset-record)
      [[ "$#" -ge 2 ]] || usage
      RESET_RECORD="$2"
      shift 2
      ;;
    --application-manifests)
      [[ "$#" -ge 2 ]] || usage
      APPLICATION_MANIFESTS_DIR="$2"
      shift 2
      ;;
    --stage-record-dir)
      [[ "$#" -ge 2 ]] || usage
      STAGE_RECORD_DIR="$2"
      shift 2
      ;;
    --final-report)
      [[ "$#" -ge 2 ]] || usage
      FINAL_REPORT="$2"
      shift 2
      ;;
    --release-attestation)
      [[ "$#" -ge 2 ]] || usage
      RELEASE_ATTESTATION="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -n "$RESET_RECORD" && "$RESET_RECORD" != /* ]]; then
  RESET_RECORD="$REPO_ROOT/$RESET_RECORD"
fi
if [[ -n "$APPLICATION_MANIFESTS_DIR" && "$APPLICATION_MANIFESTS_DIR" != /* ]]; then
  APPLICATION_MANIFESTS_DIR="$REPO_ROOT/$APPLICATION_MANIFESTS_DIR"
fi
if [[ -n "$FINAL_REPORT" && "$FINAL_REPORT" != /* ]]; then
  FINAL_REPORT="$REPO_ROOT/$FINAL_REPORT"
fi
if [[ -n "$RELEASE_ATTESTATION" && "$RELEASE_ATTESTATION" != /* ]]; then
  RELEASE_ATTESTATION="$REPO_ROOT/$RELEASE_ATTESTATION"
fi
if [[ -z "$STAGE_RECORD_DIR" && -n "${K8S_STAGE_RECORD_DIR:-}" ]]; then
  STAGE_RECORD_DIR="$K8S_STAGE_RECORD_DIR"
fi

command -v kubectl >/dev/null 2>&1 || fail 'KUBECTL_REQUIRED'

case "$STAGE" in
  bootstrap)
    if [[ "$DRY_RUN" -eq 1 ]]; then
      kubectl apply --dry-run=client -k "$K8S_DIR"
    else
      kubectl apply -k "$K8S_DIR"
      wait_for_database_dependencies
    fi
    ;;
  migrate)
    require_release_inputs
    init_stage_record_dir
    if [[ "$DRY_RUN" -eq 0 ]]; then
      [[ ! -e "$STAGE_RECORD_DIR/migration-job-uid" ]] || fail 'KUBERNETES_RELEASE_ID_ALREADY_USED'
      require_reset_record
      wait_for_database_dependencies
    fi
    mkdir -p "$REPO_ROOT/tmp"
    RENDER_DIR="$(mktemp -d "$REPO_ROOT/tmp/k8s-stage.XXXXXX")"
    trap cleanup_render_dir EXIT
    migration_name="traffic-control-plane-migrate-$RELEASE_ID"
    migration_file="$(render_job "$K8S_DIR/jobs/traffic-control-plane-migrate.yaml" "$migration_name.yaml")"
    create_job "$migration_file"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      wait_for_job "$migration_name"
      assert_job_image "$migration_name"
      write_stage_record release-id "$RELEASE_ID"
      write_stage_record control-plane-image "$CONTROL_PLANE_IMAGE"
      write_stage_record reset-record-sha256 "$(reset_record_checksum)"
      write_stage_record migration-job-uid "$(job_uid "$migration_name")"
    fi
    ;;
  verify)
    require_release_inputs
    init_stage_record_dir
    migration_name="traffic-control-plane-migrate-$RELEASE_ID"
    verify_name="traffic-control-plane-verify-$RELEASE_ID"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      require_reset_record
      assert_stage_context "$(reset_record_checksum)"
      [[ ! -e "$STAGE_RECORD_DIR/verify-job-uid" ]] || fail 'KUBERNETES_RELEASE_ID_ALREADY_USED'
      assert_job_record "$migration_name" migration-job-uid
      wait_for_job "$migration_name"
    fi
    mkdir -p "$REPO_ROOT/tmp"
    RENDER_DIR="$(mktemp -d "$REPO_ROOT/tmp/k8s-stage.XXXXXX")"
    trap cleanup_render_dir EXIT
    verify_file="$(render_job "$K8S_DIR/jobs/traffic-control-plane-verify.yaml" "$verify_name.yaml")"
    create_job "$verify_file"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      wait_for_job "$verify_name"
      assert_job_image "$verify_name"
      write_stage_record verify-job-uid "$(job_uid "$verify_name")"
    fi
    ;;
  application)
    require_release_inputs
    init_stage_record_dir
    migration_name="traffic-control-plane-migrate-$RELEASE_ID"
    verify_name="traffic-control-plane-verify-$RELEASE_ID"
    [[ -n "${APPLICATION_MANIFESTS_DIR:-}" ]] || fail 'APPLICATION_MANIFEST_SET_REQUIRED'
    validate_application_manifests "$APPLICATION_MANIFESTS_DIR"
    [[ -s "$FINAL_REPORT" && -s "$RELEASE_ATTESTATION" ]] \
      || fail 'SCENARIO_CONTRACT_RELEASE_ATTESTATION_REQUIRED'
    command -v pnpm >/dev/null 2>&1 || fail 'PNPM_REQUIRED_FOR_RELEASE_ATTESTATION'
    pnpm --dir "$REPO_ROOT/traffic-control-plane" validate:contract:release -- \
      --final-report "$FINAL_REPORT" \
      --release-attestation "$RELEASE_ATTESTATION" \
      --application-manifests "$APPLICATION_MANIFESTS_DIR" \
      --control-plane-image "$CONTROL_PLANE_IMAGE"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      require_reset_record
      assert_stage_context "$(reset_record_checksum)"
      assert_job_record "$migration_name" migration-job-uid
      wait_for_job "$migration_name"
      assert_job_record "$verify_name" verify-job-uid
      wait_for_job "$verify_name"
    fi
    apply_application_resources "$APPLICATION_MANIFESTS_DIR"
    ;;
  *)
    usage
    ;;
esac
