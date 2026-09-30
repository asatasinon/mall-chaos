#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'check-runtime-terminology: %s\n' "$1" >&2
  exit 1
}

command -v rg >/dev/null 2>&1 || fail 'required command not found: rg'
command -v pnpm >/dev/null 2>&1 || fail 'required command not found: pnpm'

if ! TERMINOLOGY_PATTERNS="$(pnpm --dir "$REPO_ROOT/traffic-control-plane" exec tsx -e '
import { listScenarioDefinitions } from "./src/lib/fault-run-catalog.ts";
import { resolveScenarioContract } from "./src/lib/scenario-contract.ts";
import { generateScenarioContractTerminologyInput } from "./src/lib/scenario-contract-artifacts.ts";

const contracts = listScenarioDefinitions().map((definition) => resolveScenarioContract(definition));
const input = generateScenarioContractTerminologyInput(contracts);
process.stdout.write([...input.reviewedTermPatterns, ...input.scenarioIdPatterns].join("\n"));
')"; then
  fail 'could not derive terminology patterns from the Catalog'
fi

[[ -n "$TERMINOLOGY_PATTERNS" ]] || fail 'Catalog-derived terminology input is empty'
PATTERN=''
while IFS= read -r terminology_pattern; do
  [[ -n "$terminology_pattern" ]] || continue
  PATTERN="${PATTERN:+$PATTERN|}${terminology_pattern}"
done <<< "$TERMINOLOGY_PATTERNS"

cd "$REPO_ROOT"
if matches="$(rg -n -i --glob '!**/target/**' --glob '!traffic-control-plane/**' --glob '**/src/**' "$PATTERN" .)"; then
  printf '%s\n' "$matches" >&2
  fail 'control-plane terminology leaked into runtime source'
else
  scan_exit=$?
fi

if [[ "$scan_exit" -ne 1 ]]; then
  fail "rg failed with exit code $scan_exit"
fi

printf 'check-runtime-terminology: passed\n'