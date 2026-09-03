import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  DatabaseZap,
  Flame,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';

export type ScenarioMeta = { label: string; description: string; icon: LucideIcon; tone: string };
export type ScenarioGroup = { label: string; scenarios: string[] };

export const SCENARIO_META: Record<string, ScenarioMeta> = {
  BROWSE_REPORT_SQL: { label: 'Browse report SQL', description: 'Run historical scans and query-plan comparisons on the product report path.', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  ORDER_REPORT_SQL: { label: 'Order report SQL', description: 'Run the customer order report range and detail aggregation path.', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  BROWSE_SURGE: { label: 'Browse traffic surge', description: 'Sustain controlled concurrency against the real product API through Gateway.', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  ORDER_QUERY_SURGE: { label: 'Order query surge', description: 'Sustain compliant demo-customer traffic against the order query path.', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  CATALOG_REDIS_LARGE_VALUE: { label: 'Product detail Redis Hash', description: 'Create and read a bounded product-detail Hash through the real catalog API.', icon: DatabaseZap, tone: 'text-emerald-700 dark:text-emerald-300' },
  CART_CATALOG_DEPENDENCY: { label: 'Cart dependency failure', description: 'Fail the real Cart-to-Catalog dependency before a cart write.', icon: ServerCog, tone: 'text-rose-700 dark:text-rose-300' },
  NOTIFICATION_HEAP_PRESSURE: { label: 'JVM memory leak', description: 'Retain high-cardinality objects until the notification JVM runs out of heap.', icon: AlertTriangle, tone: 'text-red-700 dark:text-red-300' },
  NOTIFICATION_STORAGE_APPEND: { label: 'Notification storage growth', description: 'Grow persistent storage with run-scoped notification transaction data.', icon: DatabaseZap, tone: 'text-violet-700 dark:text-violet-300' },
  PROMOTION_LOCK_CONTENTION: { label: 'Promotion deadlock', description: 'Trigger a real database deadlock through competing promotion reservations.', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_TABLE_EXCLUSIVE: { label: 'Inventory table lock', description: 'Hold an exclusive database table lock that blocks inventory reads.', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_ROW_LOCK: { label: 'Inventory row lock', description: 'Hold a row-level inventory reservation while the normal reservation summary path waits.', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  PSP_PROVIDER_OUTCOME: { label: 'PSP external dependency', description: 'Inject an external PSP dependency outcome into the payment path.', icon: ShieldCheck, tone: 'text-blue-700 dark:text-blue-300' },
};

export function getScenarioLabel(scenario: string) {
  return SCENARIO_META[scenario]?.label || scenario;
}

export const SCENARIO_GROUPS: ScenarioGroup[] = [
  { label: 'Slow SQL', scenarios: ['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'] },
  { label: 'Traffic surge', scenarios: ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'] },
  { label: 'Large value', scenarios: ['CATALOG_REDIS_LARGE_VALUE'] },
  { label: 'Dependency failure', scenarios: ['CART_CATALOG_DEPENDENCY'] },
  { label: 'Memory leak', scenarios: ['NOTIFICATION_HEAP_PRESSURE'] },
  { label: 'Storage growth', scenarios: ['NOTIFICATION_STORAGE_APPEND'] },
  { label: 'Lock', scenarios: ['PROMOTION_LOCK_CONTENTION', 'INVENTORY_TABLE_EXCLUSIVE', 'INVENTORY_ROW_LOCK'] },
  { label: 'External dependency', scenarios: ['PSP_PROVIDER_OUTCOME'] },
];

export const ACTIVE_STATES = ['CREATING', 'ACTIVE', 'RECOVERING'];
export const PROVIDER_OUTCOMES = [
  { value: 'AUTHORIZED', label: 'Authorized' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'TIMEOUT', label: 'Timeout' },
];
