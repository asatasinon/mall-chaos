import type {
  FaultRunCleanupPolicy,
  FaultRunRecoveryStrategy,
  FaultRunScenarioDefinition,
  FaultRunTargetReleasePolicy,
  FaultRunVerificationPolicy,
  FaultRunWorkerDrainOwner,
  FaultRunWorkerDrainPolicy,
} from './fault-run-catalog';

export const FAULT_RUN_WORKER_DRAIN_OWNERS = [
  'REPORT_SCENARIO_WORKER',
  'TRAFFIC_SURGE_EXECUTOR',
  'SCENARIO_WORKERS',
  'RUNNER_ENGINE',
] as const;

export interface FaultRunResolvedRecoveryPolicy {
  recoveryStrategy: FaultRunRecoveryStrategy;
  workerDrain: FaultRunWorkerDrainPolicy;
  targetRelease: FaultRunTargetReleasePolicy;
  cleanup: FaultRunCleanupPolicy;
  verification: FaultRunVerificationPolicy;
  target: {
    service: string;
    operation: string;
  };
}

export class FaultRunRecoveryPolicyInvariantError extends Error {
  constructor(public readonly code: 'INVALID_RECOVERY_POLICY') {
    super(code);
    this.name = 'FaultRunRecoveryPolicyInvariantError';
  }
}

export function assertFaultRunRecoveryPolicy(definition: FaultRunScenarioDefinition): void {
  const policy = definition.recoveryPolicy;
  if (!hasNonEmptyText(definition.targetService) || !hasNonEmptyText(definition.targetOperation)) {
    invalidPolicy();
  }
  if (!policy || typeof policy !== 'object') invalidPolicy();
  assertWorkerDrainPolicy(policy.workerDrain);
  if (!isTargetReleasePolicy(policy.targetRelease)
    || !isCleanupPolicy(policy.cleanup)
    || !isVerificationPolicy(policy.verification)) {
    invalidPolicy();
  }

  if (policy.cleanup === 'NONE' ? definition.allowManualCleanup : !definition.allowManualCleanup) {
    invalidPolicy();
  }
  if (policy.targetRelease === 'REQUIRED'
    && (!hasNonEmptyText(definition.targetService) || !hasNonEmptyText(definition.targetOperation))) {
    invalidPolicy();
  }

  switch (definition.recoveryStrategy) {
    case 'WORKER':
      if (policy.workerDrain.requirement !== 'REQUIRED'
        || policy.cleanup !== 'NONE'
        || policy.targetRelease === 'FORBIDDEN') {
        invalidPolicy();
      }
      break;
    case 'TARGET':
      if (policy.targetRelease !== 'REQUIRED'
        || (policy.cleanup !== 'NONE' && policy.cleanup !== 'OPTIONAL_PER_RUN')) {
        invalidPolicy();
      }
      break;
    case 'MANUAL_CLEANUP':
      if (policy.workerDrain.requirement !== 'REQUIRED'
        || policy.targetRelease !== 'REQUIRED'
        || policy.cleanup !== 'OPERATOR_CONFIRMED') {
        invalidPolicy();
      }
      break;
    case 'NON_RELEASING':
      if (policy.workerDrain.requirement !== 'REQUIRED'
        || policy.targetRelease !== 'FORBIDDEN'
        || policy.cleanup !== 'NONE') {
        invalidPolicy();
      }
      break;
    default:
      invalidPolicy();
  }
}

export function resolveFaultRunRecoveryPolicy(
  definition: FaultRunScenarioDefinition,
): Readonly<FaultRunResolvedRecoveryPolicy> {
  assertFaultRunRecoveryPolicy(definition);
  const workerDrain = copyWorkerDrainPolicy(definition.recoveryPolicy.workerDrain);
  return Object.freeze({
    recoveryStrategy: definition.recoveryStrategy,
    workerDrain,
    targetRelease: definition.recoveryPolicy.targetRelease,
    cleanup: definition.recoveryPolicy.cleanup,
    verification: definition.recoveryPolicy.verification,
    target: Object.freeze({
      service: definition.targetService,
      operation: definition.targetOperation,
    }),
  });
}

function copyWorkerDrainPolicy(
  policy: FaultRunWorkerDrainPolicy,
): Readonly<FaultRunWorkerDrainPolicy> {
  if (policy.requirement === 'REQUIRED') {
    return Object.freeze({
      requirement: 'REQUIRED' as const,
      owner: policy.owner,
    });
  }
  return Object.freeze({ requirement: 'NOT_APPLICABLE' as const });
}

function assertWorkerDrainPolicy(policy: FaultRunWorkerDrainPolicy): void {
  if (policy.requirement === 'REQUIRED') {
    if (!(FAULT_RUN_WORKER_DRAIN_OWNERS as readonly string[]).includes(policy.owner)) {
      invalidPolicy();
    }
    return;
  }
  if (policy.requirement !== 'NOT_APPLICABLE' || hasOwn(policy, 'owner')) invalidPolicy();
}

function isTargetReleasePolicy(value: unknown): value is FaultRunTargetReleasePolicy {
  return value === 'REQUIRED' || value === 'FORBIDDEN' || value === 'NOT_APPLICABLE';
}

function isCleanupPolicy(value: unknown): value is FaultRunCleanupPolicy {
  return value === 'NONE' || value === 'OPTIONAL_PER_RUN' || value === 'OPERATOR_CONFIRMED';
}

function isVerificationPolicy(value: unknown): value is FaultRunVerificationPolicy {
  return value === 'REQUIRED' || value === 'BEST_EFFORT' || value === 'NOT_CONFIGURED';
}

function hasNonEmptyText(value: string): boolean {
  return value.trim().length > 0;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalidPolicy(): never {
  throw new FaultRunRecoveryPolicyInvariantError('INVALID_RECOVERY_POLICY');
}

export type { FaultRunWorkerDrainOwner };
