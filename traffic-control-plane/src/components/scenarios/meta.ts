import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  DatabaseZap,
  Flame,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';

export type ScenarioTranslator = (key: string) => string;
export type ScenarioMeta = { labelKey: string; descriptionKey: string; label?: string; description?: string; icon: LucideIcon; tone: string };
export type ScenarioGroup = { labelKey: string; label: string; scenarios: string[] };

export const SCENARIO_META: Record<string, ScenarioMeta> = {
  BROWSE_REPORT_SQL: { labelKey: 'BROWSE_REPORT_SQL', descriptionKey: 'BROWSE_REPORT_SQL', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  ORDER_REPORT_SQL: { labelKey: 'ORDER_REPORT_SQL', descriptionKey: 'ORDER_REPORT_SQL', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  BROWSE_SURGE: { labelKey: 'BROWSE_SURGE', descriptionKey: 'BROWSE_SURGE', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  ORDER_QUERY_SURGE: { labelKey: 'ORDER_QUERY_SURGE', descriptionKey: 'ORDER_QUERY_SURGE', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  CATALOG_REDIS_LARGE_VALUE: { labelKey: 'CATALOG_REDIS_LARGE_VALUE', descriptionKey: 'CATALOG_REDIS_LARGE_VALUE', icon: DatabaseZap, tone: 'text-emerald-700 dark:text-emerald-300' },
  CART_CATALOG_DEPENDENCY: { labelKey: 'CART_CATALOG_DEPENDENCY', descriptionKey: 'CART_CATALOG_DEPENDENCY', icon: ServerCog, tone: 'text-rose-700 dark:text-rose-300' },
  NOTIFICATION_HEAP_PRESSURE: { labelKey: 'NOTIFICATION_HEAP_PRESSURE', descriptionKey: 'NOTIFICATION_HEAP_PRESSURE', icon: AlertTriangle, tone: 'text-red-700 dark:text-red-300' },
  NOTIFICATION_STORAGE_APPEND: { labelKey: 'NOTIFICATION_STORAGE_APPEND', descriptionKey: 'NOTIFICATION_STORAGE_APPEND', icon: DatabaseZap, tone: 'text-violet-700 dark:text-violet-300' },
  PROMOTION_LOCK_CONTENTION: { labelKey: 'PROMOTION_LOCK_CONTENTION', descriptionKey: 'PROMOTION_LOCK_CONTENTION', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_TABLE_EXCLUSIVE: { labelKey: 'INVENTORY_TABLE_EXCLUSIVE', descriptionKey: 'INVENTORY_TABLE_EXCLUSIVE', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_ROW_LOCK: { labelKey: 'INVENTORY_ROW_LOCK', descriptionKey: 'INVENTORY_ROW_LOCK', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  PSP_PROVIDER_OUTCOME: { labelKey: 'PSP_PROVIDER_OUTCOME', descriptionKey: 'PSP_PROVIDER_OUTCOME', icon: ShieldCheck, tone: 'text-blue-700 dark:text-blue-300' },
};

export function getScenarioLabel(scenario: string, translate?: ScenarioTranslator) {
  const meta = SCENARIO_META[scenario];
  return meta && translate ? translate(`scenarioMeta.${meta.labelKey}.label`) : scenario;
}

export function getScenarioDescription(scenario: string, translate?: ScenarioTranslator) {
  const meta = SCENARIO_META[scenario];
  return meta && translate ? translate(`scenarioMeta.${meta.descriptionKey}.description`) : '';
}

export function getScenarioGroupLabel(group: ScenarioGroup, translate?: ScenarioTranslator) {
  return translate ? translate(`groups.${group.labelKey}`) : group.labelKey;
}

export function getProviderOutcomeLabel(value: string, translate?: ScenarioTranslator) {
  const outcome = PROVIDER_OUTCOMES.find((item) => item.value === value);
  return outcome && translate ? translate(`providerOutcomes.${outcome.labelKey}`) : value;
}

export function getScenarioStateLabel(state: string, translate?: ScenarioTranslator) {
  const knownStates = ['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'];
  return translate && knownStates.includes(state) ? translate(`states.${state}`) : state;
}

export function getRecoveryStrategyLabel(strategy: string, translate?: ScenarioTranslator) {
  const knownStrategies = ['TARGET', 'WORKER', 'NON_RELEASING', 'MANUAL_CLEANUP'];
  return translate && knownStrategies.includes(strategy) ? translate(`recoveryStrategies.${strategy}`) : strategy;
}

export const SCENARIO_GROUPS: ScenarioGroup[] = [
  { labelKey: 'databaseFaults', label: 'databaseFaults', scenarios: ['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL', 'PROMOTION_LOCK_CONTENTION', 'INVENTORY_TABLE_EXCLUSIVE', 'INVENTORY_ROW_LOCK'] },
  { labelKey: 'trafficLoad', label: 'trafficLoad', scenarios: ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'] },
  { labelKey: 'cacheFaults', label: 'cacheFaults', scenarios: ['CATALOG_REDIS_LARGE_VALUE'] },
  { labelKey: 'businessDependencyFailures', label: 'businessDependencyFailures', scenarios: ['CART_CATALOG_DEPENDENCY', 'PSP_PROVIDER_OUTCOME'] },
  { labelKey: 'jvmFaults', label: 'jvmFaults', scenarios: ['NOTIFICATION_HEAP_PRESSURE'] },
  { labelKey: 'storagePressure', label: 'storagePressure', scenarios: ['NOTIFICATION_STORAGE_APPEND'] },
];

export const ACTIVE_STATES = ['CREATING', 'ACTIVE', 'RECOVERING'];
export const PROVIDER_OUTCOMES = [
  { value: 'AUTHORIZED', labelKey: 'AUTHORIZED', label: 'AUTHORIZED' },
  { value: 'DECLINED', labelKey: 'DECLINED', label: 'DECLINED' },
  { value: 'TIMEOUT', labelKey: 'TIMEOUT', label: 'TIMEOUT' },
];
