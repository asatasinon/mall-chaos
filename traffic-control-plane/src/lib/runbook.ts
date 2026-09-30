import type {
  FaultRunScenario,
  FaultRunScenarioDefinition,
} from './fault-run-catalog';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
} from './fault-run-catalog';
import {
  resolveScenarioContract,
  type EvidencePredicate,
  type EvidenceTemplateId,
  type ResolvedScenarioContract,
} from './scenario-contract';

export type RunbookImpactScope =
  | 'REQUEST'
  | 'CUSTOMER'
  | 'ROW'
  | 'TABLE'
  | 'SERVICE'
  | 'DEPENDENCY'
  | 'PLATFORM';

export type TempoWaterfallCheck = 'HTTP' | 'JDBC' | 'REDIS' | 'EXCEPTION' | 'HEALTH';

export type TempoQueryTemplate = Extract<
  EvidenceTemplateId,
  'SERVICE_REQUESTS' | 'SERVICE_ERRORS' | 'SERVICE_SLOW_REQUESTS' | 'SERVICE_ROUTE_REQUESTS'
>;

export type TempoGuidance = {
  timeRange: 'now-1h to now';
  waterfallChecks: readonly TempoWaterfallCheck[];
};

export type TempoQuery = {
  recipeId: string;
  template: TempoQueryTemplate;
  serviceName: string;
  route?: string;
  predicate: EvidencePredicate;
  query: string;
};

export type RunbookScenarioInput = string | string[] | undefined;

export type ScenarioRunbookMetadata = {
  articleFile: string;
  impactScope: RunbookImpactScope;
  affectedResources: readonly string[];
  explicitlyExcluded: readonly string[];
  businessPath: readonly string[];
  tempo: TempoGuidance;
};

export type RunbookEntry = FaultRunScenarioDefinition & ScenarioRunbookMetadata & {
  tempo: TempoGuidance & { businessPath: readonly string[] };
  tempoQueries: readonly TempoQuery[];
};

const timeRange = 'now-1h to now' as const;

function tempo(waterfallChecks: readonly TempoWaterfallCheck[]): TempoGuidance {
  return { timeRange, waterfallChecks };
}

export const RUNBOOK_METADATA: Readonly<Record<FaultRunScenario, ScenarioRunbookMetadata>> = {
  BROWSE_REPORT_SQL: {
    articleFile: 'browse-report-sql.md',
    impactScope: 'REQUEST',
    affectedResources: ['catalog-service report requests', 'user_behavior_log reads', 'Catalog JDBC connection pool'],
    explicitlyExcluded: ['business data writes', 'order-service', 'payment-service'],
    businessPath: ['GET /api/reports/product-browse', 'catalog-service', 'MySQL user_behavior_log'],
    tempo: tempo(['HTTP', 'JDBC']),
  },
  ORDER_REPORT_SQL: {
    articleFile: 'order-report-sql.md',
    impactScope: 'CUSTOMER',
    affectedResources: ['selected customer order report', 'orders reads', 'order_items reads', 'Order JDBC connection pool'],
    explicitlyExcluded: ['other customers\' order data', 'business data writes', 'payment authorization'],
    businessPath: ['GET /api/reports/order-query', 'order-service', 'orders', 'order_items'],
    tempo: tempo(['HTTP', 'JDBC']),
  },
  BROWSE_SURGE: {
    articleFile: 'browse-surge.md',
    impactScope: 'PLATFORM',
    affectedResources: ['gateway-service', 'catalog-service', 'product conversion inventory reads', 'backing stores'],
    explicitlyExcluded: ['traffic-control-plane as a Tempo service', 'Runner configuration', 'customer ID 19'],
    businessPath: ['GET /api/products', 'traffic-control-plane worker', 'gateway-service', 'catalog-service'],
    tempo: tempo(['HTTP', 'JDBC']),
  },
  ORDER_QUERY_SURGE: {
    articleFile: 'order-query-surge.md',
    impactScope: 'CUSTOMER',
    affectedResources: ['gateway-service', 'order-service', 'Order DB', 'selected demonstration customer query path'],
    explicitlyExcluded: ['traffic-control-plane as a Tempo service', 'Runner configuration', 'customer ID 19'],
    businessPath: ['GET /api/orders', 'traffic-control-plane worker', 'gateway-service', 'order-service'],
    tempo: tempo(['HTTP', 'JDBC']),
  },
  CATALOG_REDIS_LARGE_VALUE: {
    articleFile: 'catalog-redis-large-value.md',
    impactScope: 'REQUEST',
    affectedResources: ['selected catalog product-detail reads', 'catalog-service heap and network', 'shared Redis'],
    explicitlyExcluded: ['default product cache', 'business data', 'arbitrary Redis keys'],
    businessPath: ['GET /api/products/{sku}', 'catalog-service', 'Redis run-scoped Hash', 'product detail serialization'],
    tempo: tempo(['HTTP', 'REDIS', 'EXCEPTION']),
  },
  CART_CATALOG_DEPENDENCY: {
    articleFile: 'cart-catalog-dependency.md',
    impactScope: 'DEPENDENCY',
    affectedResources: ['Cart add-item validation requests', 'cart-service to catalog-service HTTP dependency'],
    explicitlyExcluded: ['Cart and CartItem writes before validation', 'catalog-service APIs other than product validation'],
    businessPath: ['POST /api/cart/items', 'cart-service', 'GET /internal/catalog/products/{sku}/validate', 'catalog-service'],
    tempo: tempo(['HTTP', 'EXCEPTION']),
  },
  NOTIFICATION_HEAP_PRESSURE: {
    articleFile: 'notification-heap-pressure.md',
    impactScope: 'SERVICE',
    affectedResources: ['notification-service JVM heap', 'notification processing', 'service health'],
    explicitlyExcluded: ['automatic release of retained objects', 'guaranteed final trace export', 'automatic service restart'],
    businessPath: ['normal notification delivery', 'notification-service', 'retained byte[] objects', 'JVM heap and GC'],
    tempo: tempo(['HTTP', 'EXCEPTION', 'HEALTH']),
  },
  NOTIFICATION_STORAGE_APPEND: {
    articleFile: 'notification-storage-append.md',
    impactScope: 'SERVICE',
    affectedResources: ['notification storage volume', 'run-scoped growth file', 'dedicated storage append endpoint'],
    explicitlyExcluded: ['normal notification delivery APIs', 'order, payment, and shipping traffic', 'automatic data deletion at expiry', 'guaranteed volume quota availability'],
    businessPath: ['runner', 'Gateway', 'notification storage append endpoint', 'run-scoped storage file', 'physical file growth'],
    tempo: tempo(['HTTP', 'EXCEPTION', 'HEALTH']),
  },
  PROMOTION_LOCK_CONTENTION: {
    articleFile: 'promotion-lock-contention.md',
    impactScope: 'ROW',
    affectedResources: ['prepared coupon reservation rows', 'promotion-service transactions', 'shared MySQL lock manager'],
    explicitlyExcluded: ['arbitrary customer coupons', 'unrelated service endpoints', 'guaranteed deadlock timing'],
    businessPath: ['coupon reservation consistency', 'promotion-service', 'coupon', 'coupon_reservation'],
    tempo: tempo(['HTTP', 'JDBC', 'EXCEPTION']),
  },
  INVENTORY_TABLE_EXCLUSIVE: {
    articleFile: 'inventory-table-exclusive.md',
    impactScope: 'TABLE',
    affectedResources: ['inventories table', 'inventory-service JDBC connections', 'inventory availability report requests'],
    explicitlyExcluded: ['tables other than inventories', 'fixed row-only scope', 'guaranteed lock timeout duration'],
    businessPath: ['LOCK TABLES inventories WRITE', 'POST /internal/inventory/availability/report', 'inventory-service'],
    tempo: tempo(['HTTP', 'JDBC', 'EXCEPTION']),
  },
  INVENTORY_ROW_LOCK: {
    articleFile: 'inventory-row-lock.md',
    impactScope: 'ROW',
    affectedResources: ['inventories row SKU-001', 'transactions requiring that row lock', 'inventory-service JDBC connections'],
    explicitlyExcluded: ['whole inventories table lock', 'other SKU rows unless they share a transaction resource', 'guaranteed lock timeout duration'],
    businessPath: ['SELECT ... WHERE sku = \'SKU-001\' FOR UPDATE', 'POST /internal/inventory/reservations/summary', 'inventory-service'],
    tempo: tempo(['HTTP', 'JDBC', 'EXCEPTION']),
  },
  PSP_PROVIDER_OUTCOME: {
    articleFile: 'psp-provider-outcome.md',
    impactScope: 'DEPENDENCY',
    affectedResources: ['psp-simulator authorization requests', 'payment-service PSP client', 'dependent payment/order workflow'],
    explicitlyExcluded: ['all payment requests when effectPercentage is below 100', 'payment-service as a generic fault target', 'guaranteed provider response timing'],
    businessPath: ['payment-service', 'POST /api/psp/authorize', 'psp-simulator', 'payment confirmation'],
    tempo: tempo(['HTTP', 'EXCEPTION', 'HEALTH']),
  },
};

export const DEFAULT_RUNBOOK_SCENARIO: FaultRunScenario = listScenarioDefinitions()[0]?.scenario
  || 'BROWSE_REPORT_SQL';

const KNOWN_SCENARIOS = new Set<FaultRunScenario>(listScenarioDefinitions().map(({ scenario }) => scenario));

function quoteTraceQL(value: string): string {
  return JSON.stringify(value);
}

function wrapTraceQL(expression: string): string {
  return `{ ${expression} }`;
}

function traceQLComparisonOperator(
  operator: Extract<EvidencePredicate, { kind: 'COMPARISON' }>['operator'],
): string {
  switch (operator) {
    case 'GT': return '>';
    case 'GTE': return '>=';
    case 'LT': return '<';
    case 'LTE': return '<=';
    case 'EQ': return '=';
  }
}

function formatTempoDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('RUNBOOK_TEMPO_CONTRACT_INVALID');
  }
  const milliseconds = seconds * 1000;
  return Number.isSafeInteger(milliseconds) && milliseconds < 1000
    ? `${milliseconds}ms`
    : `${seconds}s`;
}

export function buildTempoQueries(
  contract: Pick<ResolvedScenarioContract, 'evidence'>,
): readonly TempoQuery[] {
  return contract.evidence.recipes
    .filter((recipe) => recipe.source === 'TEMPO' && recipe.window === 'active')
    .map((recipe) => {
      const baseFilters = [
        `resource.service.name = ${quoteTraceQL(recipe.scope.service)}`,
        ...(recipe.scope.route === undefined
          ? []
          : [`span.http.route = ${quoteTraceQL(recipe.scope.route)}`]),
      ];
      let queryFilters: string[];
      switch (recipe.template) {
        case 'SERVICE_REQUESTS':
          queryFilters = baseFilters;
          break;
        case 'SERVICE_ERRORS':
          queryFilters = [...baseFilters, 'status = error'];
          break;
        case 'SERVICE_SLOW_REQUESTS':
          if (recipe.predicate.kind !== 'COMPARISON') {
            throw new Error('RUNBOOK_TEMPO_CONTRACT_INVALID');
          }
          queryFilters = [
            ...baseFilters,
            `duration ${traceQLComparisonOperator(recipe.predicate.operator)} ${formatTempoDuration(recipe.predicate.value)}`,
          ];
          break;
        case 'SERVICE_ROUTE_REQUESTS':
          if (recipe.scope.route === undefined) {
            throw new Error('RUNBOOK_TEMPO_CONTRACT_INVALID');
          }
          queryFilters = baseFilters;
          break;
        default:
          throw new Error('RUNBOOK_TEMPO_CONTRACT_INVALID');
      }
      return {
        recipeId: recipe.id,
        template: recipe.template,
        serviceName: recipe.scope.service,
        ...(recipe.scope.route === undefined ? {} : { route: recipe.scope.route }),
        predicate: recipe.predicate,
        query: wrapTraceQL(queryFilters.join(' && ')),
      };
    })
    .sort((left, right) => (
      left.serviceName.localeCompare(right.serviceName)
      || (left.route ?? '').localeCompare(right.route ?? '')
      || left.template.localeCompare(right.template)
      || left.recipeId.localeCompare(right.recipeId)
    ));
}

export function getRunbookEntry(scenario: string): RunbookEntry {
  const definition = getScenarioDefinition(scenario);
  const metadata = RUNBOOK_METADATA[definition.scenario];
  const contract = resolveScenarioContract(definition);
  return {
    ...metadata,
    ...definition,
    tempo: { ...metadata.tempo, businessPath: metadata.businessPath },
    tempoQueries: buildTempoQueries(contract),
  };
}

export function listRunbookEntries(): RunbookEntry[] {
  return listScenarioDefinitions().map(({ scenario }) => getRunbookEntry(scenario));
}

export function resolveRunbookScenario(input: RunbookScenarioInput): FaultRunScenario {
  if (typeof input !== 'string' || !KNOWN_SCENARIOS.has(input as FaultRunScenario)) {
    return DEFAULT_RUNBOOK_SCENARIO;
  }
  return input as FaultRunScenario;
}