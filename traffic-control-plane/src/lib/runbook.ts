import type {
  FaultRunScenario,
  FaultRunScenarioDefinition,
} from './fault-run-catalog';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
} from './fault-run-catalog';

export type RunbookImpactScope =
  | 'REQUEST'
  | 'CUSTOMER'
  | 'ROW'
  | 'TABLE'
  | 'SERVICE'
  | 'DEPENDENCY'
  | 'PLATFORM';

export type TempoWaterfallCheck = 'HTTP' | 'JDBC' | 'REDIS' | 'EXCEPTION' | 'HEALTH';

export type TempoServiceTarget = {
  serviceName: string;
  route?: string;
};

export type TempoQueryRecipe = {
  targets: readonly TempoServiceTarget[];
  businessPath: readonly string[];
  timeRange: 'now-1h to now';
  slowThreshold: string;
  waterfallChecks: readonly TempoWaterfallCheck[];
};

export type TempoQuery = {
  serviceName: string;
  route?: string;
  serviceQuery: string;
  errorQuery: string;
  slowQuery: string;
  routeQuery?: string;
};

export type RunbookScenarioInput = string | string[] | undefined;

export type ScenarioRunbookMetadata = {
  scenario: FaultRunScenario;
  articleFile: string;
  impactScope: RunbookImpactScope;
  affectedResources: readonly string[];
  explicitlyExcluded: readonly string[];
  businessPath: readonly string[];
  tempo: TempoQueryRecipe;
};

export type RunbookEntry = FaultRunScenarioDefinition & ScenarioRunbookMetadata & {
  tempoQueries: readonly TempoQuery[];
};

const timeRange = 'now-1h to now' as const;

function tempo(
  targets: readonly TempoServiceTarget[],
  businessPath: readonly string[],
  slowThreshold: string,
  waterfallChecks: readonly TempoWaterfallCheck[],
): TempoQueryRecipe {
  return { targets, businessPath, timeRange, slowThreshold, waterfallChecks };
}

const target = (serviceName: string, route?: string): TempoServiceTarget => (
  route === undefined ? { serviceName } : { serviceName, route }
);

export const RUNBOOK_METADATA: Readonly<Record<FaultRunScenario, ScenarioRunbookMetadata>> = {
  BROWSE_REPORT_SQL: {
    scenario: 'BROWSE_REPORT_SQL',
    articleFile: 'browse-report-sql.md',
    impactScope: 'REQUEST',
    affectedResources: ['catalog-service report requests', 'user_behavior_log reads', 'Catalog JDBC connection pool'],
    explicitlyExcluded: ['business data writes', 'order-service', 'payment-service'],
    businessPath: ['GET /api/reports/product-browse', 'catalog-service', 'MySQL user_behavior_log'],
    tempo: tempo(
      [target('catalog-service', '/api/reports/product-browse')],
      ['GET /api/reports/product-browse', 'catalog-service', 'MySQL user_behavior_log'],
      '2s',
      ['HTTP', 'JDBC'],
    ),
  },
  ORDER_REPORT_SQL: {
    scenario: 'ORDER_REPORT_SQL',
    articleFile: 'order-report-sql.md',
    impactScope: 'CUSTOMER',
    affectedResources: ['selected customer order report', 'orders reads', 'order_items reads', 'Order JDBC connection pool'],
    explicitlyExcluded: ['other customers\' order data', 'business data writes', 'payment authorization'],
    businessPath: ['GET /api/reports/order-query', 'order-service', 'orders', 'order_items'],
    tempo: tempo(
      [target('order-service', '/api/reports/order-query')],
      ['GET /api/reports/order-query', 'order-service', 'orders', 'order_items'],
      '2s',
      ['HTTP', 'JDBC'],
    ),
  },
  BROWSE_SURGE: {
    scenario: 'BROWSE_SURGE',
    articleFile: 'browse-surge.md',
    impactScope: 'PLATFORM',
    affectedResources: ['gateway-service', 'catalog-service', 'product conversion inventory reads', 'backing stores'],
    explicitlyExcluded: ['traffic-control-plane as a Tempo service', 'Runner configuration', 'customer ID 19'],
    businessPath: ['GET /api/products', 'traffic-control-plane worker', 'gateway-service', 'catalog-service'],
    tempo: tempo(
      [target('gateway-service', '/api/products'), target('catalog-service', '/api/products')],
      ['GET /api/products', 'traffic-control-plane worker', 'gateway-service', 'catalog-service'],
      '1s',
      ['HTTP', 'JDBC'],
    ),
  },
  ORDER_QUERY_SURGE: {
    scenario: 'ORDER_QUERY_SURGE',
    articleFile: 'order-query-surge.md',
    impactScope: 'CUSTOMER',
    affectedResources: ['gateway-service', 'order-service', 'Order DB', 'selected demonstration customer query path'],
    explicitlyExcluded: ['traffic-control-plane as a Tempo service', 'Runner configuration', 'customer ID 19'],
    businessPath: ['GET /api/orders', 'traffic-control-plane worker', 'gateway-service', 'order-service'],
    tempo: tempo(
      [target('gateway-service', '/api/orders'), target('order-service', '/api/orders')],
      ['GET /api/orders', 'traffic-control-plane worker', 'gateway-service', 'order-service'],
      '1s',
      ['HTTP', 'JDBC'],
    ),
  },
  CATALOG_REDIS_LARGE_VALUE: {
    scenario: 'CATALOG_REDIS_LARGE_VALUE',
    articleFile: 'catalog-redis-large-value.md',
    impactScope: 'REQUEST',
    affectedResources: ['selected catalog product-detail reads', 'catalog-service heap and network', 'shared Redis'],
    explicitlyExcluded: ['default product cache', 'business data', 'arbitrary Redis keys'],
    businessPath: ['GET /api/products/{sku}', 'catalog-service', 'Redis run-scoped Hash', 'product detail serialization'],
    tempo: tempo(
      [target('catalog-service', '/api/products/{sku}')],
      ['GET /api/products/{sku}', 'catalog-service', 'Redis run-scoped Hash', 'product detail serialization'],
      '1s',
      ['HTTP', 'REDIS', 'EXCEPTION'],
    ),
  },
  CART_CATALOG_DEPENDENCY: {
    scenario: 'CART_CATALOG_DEPENDENCY',
    articleFile: 'cart-catalog-dependency.md',
    impactScope: 'DEPENDENCY',
    affectedResources: ['Cart add-item validation requests', 'cart-service to catalog-service HTTP dependency'],
    explicitlyExcluded: ['Cart and CartItem writes before validation', 'catalog-service APIs other than product validation'],
    businessPath: ['POST /api/cart/items', 'cart-service', 'GET /internal/catalog/products/{sku}/validate', 'catalog-service'],
    tempo: tempo(
      [target('cart-service', '/api/cart/items'), target('catalog-service')],
      ['POST /api/cart/items', 'cart-service', 'GET /internal/catalog/products/{sku}/validate', 'catalog-service'],
      '500ms',
      ['HTTP', 'EXCEPTION'],
    ),
  },
  NOTIFICATION_HEAP_PRESSURE: {
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    articleFile: 'notification-heap-pressure.md',
    impactScope: 'SERVICE',
    affectedResources: ['notification-service JVM heap', 'notification processing', 'service health'],
    explicitlyExcluded: ['automatic release of retained objects', 'guaranteed final trace export', 'automatic service restart'],
    businessPath: ['normal notification delivery', 'notification-service', 'retained byte[] objects', 'JVM heap and GC'],
    tempo: tempo(
      [target('notification-service')],
      ['normal notification delivery', 'notification-service', 'retained byte[] objects', 'JVM heap and GC'],
      '1s',
      ['HTTP', 'EXCEPTION', 'HEALTH'],
    ),
  },
  NOTIFICATION_STORAGE_APPEND: {
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    articleFile: 'notification-storage-append.md',
    impactScope: 'SERVICE',
    affectedResources: ['notification persistence transactions', 'run-scoped logical byte reservation', 'notification rows'],
    explicitlyExcluded: ['verified physical disk exhaustion', 'unrelated business tables', 'automatic data deletion at expiry'],
    businessPath: ['normal notification persistence', 'notification-service', 'notification rows', 'logical byte reservation'],
    tempo: tempo(
      [target('notification-service')],
      ['normal notification persistence', 'notification-service', 'notification rows', 'logical byte reservation'],
      '1s',
      ['HTTP', 'JDBC', 'EXCEPTION'],
    ),
  },
  PROMOTION_LOCK_CONTENTION: {
    scenario: 'PROMOTION_LOCK_CONTENTION',
    articleFile: 'promotion-lock-contention.md',
    impactScope: 'ROW',
    affectedResources: ['prepared coupon reservation rows', 'promotion-service transactions', 'shared MySQL lock manager'],
    explicitlyExcluded: ['arbitrary customer coupons', 'unrelated service endpoints', 'guaranteed deadlock timing'],
    businessPath: ['coupon reservation consistency', 'promotion-service', 'coupon', 'coupon_reservation'],
    tempo: tempo(
      [target('promotion-service')],
      ['coupon reservation consistency', 'promotion-service', 'coupon', 'coupon_reservation'],
      '1s',
      ['HTTP', 'JDBC', 'EXCEPTION'],
    ),
  },
  INVENTORY_TABLE_EXCLUSIVE: {
    scenario: 'INVENTORY_TABLE_EXCLUSIVE',
    articleFile: 'inventory-table-exclusive.md',
    impactScope: 'TABLE',
    affectedResources: ['inventories table', 'inventory-service JDBC connections', 'inventory availability report requests'],
    explicitlyExcluded: ['tables other than inventories', 'fixed row-only scope', 'guaranteed lock timeout duration'],
    businessPath: ['LOCK TABLES inventories WRITE', 'POST /internal/inventory/availability/report', 'inventory-service'],
    tempo: tempo(
      [target('inventory-service', '/internal/inventory/availability/report')],
      ['LOCK TABLES inventories WRITE', 'POST /internal/inventory/availability/report', 'inventory-service'],
      '1s',
      ['HTTP', 'JDBC', 'EXCEPTION'],
    ),
  },
  INVENTORY_ROW_LOCK: {
    scenario: 'INVENTORY_ROW_LOCK',
    articleFile: 'inventory-row-lock.md',
    impactScope: 'ROW',
    affectedResources: ['inventories row SKU-001', 'transactions requiring that row lock', 'inventory-service JDBC connections'],
    explicitlyExcluded: ['whole inventories table lock', 'other SKU rows unless they share a transaction resource', 'guaranteed lock timeout duration'],
    businessPath: ['SELECT ... WHERE sku = \'SKU-001\' FOR UPDATE', 'POST /internal/inventory/reservations/summary', 'inventory-service'],
    tempo: tempo(
      [target('inventory-service', '/internal/inventory/reservations/summary')],
      ['SELECT ... WHERE sku = \'SKU-001\' FOR UPDATE', 'POST /internal/inventory/reservations/summary', 'inventory-service'],
      '1s',
      ['HTTP', 'JDBC', 'EXCEPTION'],
    ),
  },
  PSP_PROVIDER_OUTCOME: {
    scenario: 'PSP_PROVIDER_OUTCOME',
    articleFile: 'psp-provider-outcome.md',
    impactScope: 'DEPENDENCY',
    affectedResources: ['psp-simulator authorization requests', 'payment-service PSP client', 'dependent payment/order workflow'],
    explicitlyExcluded: ['all payment requests when effectPercentage is below 100', 'payment-service as a generic fault target', 'guaranteed provider response timing'],
    businessPath: ['payment-service', 'POST /api/psp/authorize', 'psp-simulator', 'payment confirmation'],
    tempo: tempo(
      [target('payment-service'), target('psp-simulator', '/api/psp/authorize')],
      ['payment-service', 'POST /api/psp/authorize', 'psp-simulator', 'payment confirmation'],
      '3s',
      ['HTTP', 'EXCEPTION', 'HEALTH'],
    ),
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

export function buildTempoQueries(recipe: TempoQueryRecipe): readonly TempoQuery[] {
  return recipe.targets.map(({ serviceName, route }) => {
    const serviceFilter = `resource.service.name = ${quoteTraceQL(serviceName)}`;
    const result: TempoQuery = {
      serviceName,
      ...(route === undefined ? {} : { route }),
      serviceQuery: wrapTraceQL(serviceFilter),
      errorQuery: wrapTraceQL(`${serviceFilter} && status = error`),
      slowQuery: wrapTraceQL(`${serviceFilter} && duration > ${recipe.slowThreshold}`),
      ...(route === undefined ? {} : {
        routeQuery: wrapTraceQL(`${serviceFilter} && span.http.route = ${quoteTraceQL(route)}`),
      }),
    };
    return result;
  });
}

export function getRunbookEntry(scenario: string): RunbookEntry {
  const definition = getScenarioDefinition(scenario);
  const metadata = RUNBOOK_METADATA[definition.scenario];
  return {
    ...definition,
    ...metadata,
    tempoQueries: buildTempoQueries(metadata.tempo),
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