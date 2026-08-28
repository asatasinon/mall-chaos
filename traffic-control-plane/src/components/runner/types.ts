export interface RunnerStatus {
  running: boolean;
  workerOnline: boolean;
  enabled: boolean;
  paused: boolean;
  trafficMode: 'CUSTOMER_LIFECYCLE';
  lifecycleIntervalSec: number;
  configVersion: number;
  trafficRunId: string | null;
  currentLifecycleId: string | null;
  lastLifecycleStartedAt: string | null;
  lastLifecycleCompletedAt: string | null;
  lifecycleStartedCount: number;
  lifecycleCompletedCount: number;
  lifecycleNoopCount: number;
  lifecycleFailedCount: number;
  lifecycleInterruptedCount: number;
  averageIntervalSec: number | null;
}

export interface RunnerConfig {
  version: number;
  enabled: boolean;
  trafficMode: 'CUSTOMER_LIFECYCLE';
  lifecycleIntervalSec: number;
  maxItems: number;
  maxItemQuantity: number;
  successfulPaymentRatio: number;
  couponUsageRatio: number;
  backgroundActionsEnabled: boolean;
}

export interface ConfigForm {
  lifecycleIntervalSec: string;
  maxItems: string;
  maxItemQuantity: string;
  successfulPaymentRatio: string;
  couponUsageRatio: string;
}

export interface AccountSummary {
  count: number;
  enabledCount: number;
  accounts: Array<{ label: string; enabled: boolean; expectedCustomerId?: number }>;
}

export interface ActivityEntry {
  ts: number;
  action: string;
  success: boolean;
  latencyMs: number;
  lifecycleId?: string;
  trafficRunId?: string;
  customerId?: number;
  orderId?: string;
  paymentId?: string;
  traceId?: string;
  status?: string;
  errorCode?: string;
}

export interface InventoryReplenishmentStatus {
  running: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
  lastAddedQuantity: number;
  lastSkippedCount: number;
  lastFailedCount: number;
}

export interface CouponReplenishmentStatus {
  running: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
}

export interface WarmupTable {
  tableName: string;
  status: string;
  actualRows: number;
  currentDate: string;
  dayTargetRows: number;
  dayCompletedRows: number;
  tableBytes: number;
  guardReason: string | null;
}

export interface WarmupJob {
  id: number;
  operation: 'INJECT' | 'CLEANUP';
  tableName: string;
  dates: string[];
  rowsPerDay: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED_GUARD';
  processedDays: number;
  processedRows: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WarmupProgressResponse {
  windowDays: number;
  rowsPerDay: number;
  targetRows: number;
  tables: WarmupTable[];
}

export type WarmupJobRequest = {
  operation: 'INJECT' | 'CLEANUP';
  tableName: string;
  dates: string[];
  rowsPerDay: number;
};

export type WarmupCleanupConfirmation = { tableName: string; dates: string[] };
export type LifecycleStep = Record<string, unknown>;
