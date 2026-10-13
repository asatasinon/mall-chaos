import { isAbortError } from './abort-signal';
import { GatewayBoundedReadError, GatewayClient, GatewayRequestError, getGatewayClient } from './gateway-client';
import type { RenderedEvidenceRecipe } from './evidence-types';
import { EvidenceTypeError, parseEvidenceSqlTimestamp } from './evidence-types';
import type { EvidenceWebConfig } from './evidence-web-config';

export type EvidenceBusinessCheckErrorCode =
  | 'BUSINESS_CHECK_DISABLED'
  | 'BUSINESS_CHECK_INVALID_RECIPE'
  | 'BUSINESS_CHECK_TIMEOUT'
  | 'BUSINESS_CHECK_UNAVAILABLE'
  | 'BUSINESS_CHECK_RESPONSE_INVALID';

export class EvidenceBusinessCheckError extends Error {
  constructor(readonly code: EvidenceBusinessCheckErrorCode) {
    super(code);
    this.name = 'EvidenceBusinessCheckError';
  }
}

export interface EvidenceBusinessCheckResult {
  readonly source: 'BUSINESS_CHECK';
  readonly recipeId: string;
  readonly businessCheckId: 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT';
  readonly status: 'PASS' | 'FAIL' | 'NO_DATA';
  readonly checkedAt: string;
  readonly reasonCode: string | null;
}

interface EvidenceBusinessCheckDefinition {
  readonly path: '/api/products' | '/api/reports/product-browse';
  readonly service: 'catalog-service';
  readonly route: '/api/products' | '/api/reports/product-browse';
  readonly params?: { readonly sort: 'latest'; readonly page: '0'; readonly size: '1' };
}

const CHECKS: Readonly<Record<
  'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT',
  EvidenceBusinessCheckDefinition
>> = {
  CATALOG_PRODUCT_LIST: {
    path: '/api/products',
    service: 'catalog-service',
    route: '/api/products',
    params: { sort: 'latest', page: '0', size: '1' },
  },
  CATALOG_BROWSE_REPORT: {
    path: '/api/reports/product-browse',
    service: 'catalog-service',
    route: '/api/reports/product-browse',
  },
};

type GatewayEvidenceReadClient = Pick<GatewayClient, 'getBoundedEvidenceRead'>;

export class EvidenceBusinessChecks {
  constructor(
    private readonly config: EvidenceWebConfig,
    private readonly gateway: GatewayEvidenceReadClient = getGatewayClient(),
  ) {}

  async check(
    recipe: RenderedEvidenceRecipe,
    checkedAt: string,
    signal?: AbortSignal,
  ): Promise<EvidenceBusinessCheckResult> {
    if (!this.config.queryEnabled || !this.config.executionEnabled) {
      throw new EvidenceBusinessCheckError('BUSINESS_CHECK_DISABLED');
    }
    const checkId = validateRecipe(recipe);
    const definition = CHECKS[checkId];
    if (recipe.scope.service !== definition.service
      || recipe.scope.route !== definition.route
      || recipe.scope.fixedLabels !== undefined) {
      throw new EvidenceBusinessCheckError('BUSINESS_CHECK_INVALID_RECIPE');
    }
    const checkedAtUtc = normalizeCheckedAt(checkedAt);
    if (signal?.aborted) throw new EvidenceBusinessCheckError('BUSINESS_CHECK_TIMEOUT');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.sourceTimeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const response = await this.gateway.getBoundedEvidenceRead(
        definition.path,
        definition.params ? { ...definition.params } : undefined,
        { maxResponseBytes: this.config.maxResponseBytes, signal: controller.signal },
      );
      return projectCheckResponse(recipe, checkId, checkedAtUtc, response.body);
    } catch (error) {
      if (error instanceof EvidenceBusinessCheckError) throw error;
      if (error instanceof GatewayBoundedReadError) {
        if (error.code === 'RESPONSE_INVALID') {
          throw new EvidenceBusinessCheckError('BUSINESS_CHECK_RESPONSE_INVALID');
        }
        if (error.code === 'PATH_NOT_ALLOWED') {
          throw new EvidenceBusinessCheckError('BUSINESS_CHECK_INVALID_RECIPE');
        }
        throw new EvidenceBusinessCheckError('BUSINESS_CHECK_UNAVAILABLE');
      }
      if (error instanceof GatewayRequestError) {
        throw new EvidenceBusinessCheckError('BUSINESS_CHECK_UNAVAILABLE');
      }
      if (controller.signal.aborted || isAbortError(error)) {
        throw new EvidenceBusinessCheckError('BUSINESS_CHECK_TIMEOUT');
      }
      throw new EvidenceBusinessCheckError('BUSINESS_CHECK_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

function validateRecipe(
  recipe: RenderedEvidenceRecipe,
): 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT' {
  if (recipe.source !== 'BUSINESS_CHECK'
    || recipe.observationMode !== 'CURRENT'
    || recipe.renderedQuery !== null
    || recipe.businessCheckId === null
    || recipe.template !== recipe.businessCheckId
    || recipe.scopeMode !== 'DECLARED'
    || recipe.predicate.kind !== 'NONE'
    || recipe.projection !== 'BOOLEAN'
    || recipe.valueUnit !== 'boolean'
    || recipe.aggregation !== 'CURRENT_BOOLEAN'
    || recipe.businessCheckId !== 'CATALOG_PRODUCT_LIST'
      && recipe.businessCheckId !== 'CATALOG_BROWSE_REPORT') {
    throw new EvidenceBusinessCheckError('BUSINESS_CHECK_INVALID_RECIPE');
  }
  return recipe.businessCheckId;
}

function projectCheckResponse(
  recipe: RenderedEvidenceRecipe,
  checkId: EvidenceBusinessCheckResult['businessCheckId'],
  checkedAt: string,
  value: unknown,
): EvidenceBusinessCheckResult {
  if (!isRecord(value) || !Number.isInteger(value.code)) {
    throw new EvidenceBusinessCheckError('BUSINESS_CHECK_RESPONSE_INVALID');
  }
  if (value.code !== 200) {
    return {
      source: 'BUSINESS_CHECK',
      recipeId: recipe.recipeId,
      businessCheckId: checkId,
      status: 'FAIL',
      checkedAt,
      reasonCode: 'BUSINESS_CHECK_FAILED',
    };
  }

  const data = value.data;
  if (data === null || data === undefined) {
    return {
      source: 'BUSINESS_CHECK',
      recipeId: recipe.recipeId,
      businessCheckId: checkId,
      status: 'NO_DATA',
      checkedAt,
      reasonCode: null,
    };
  }
  if (checkId === 'CATALOG_PRODUCT_LIST') {
    if (!isRecord(data) || !Array.isArray(data.content) || data.content.length > 1) {
      throw new EvidenceBusinessCheckError('BUSINESS_CHECK_RESPONSE_INVALID');
    }
    return {
      source: 'BUSINESS_CHECK',
      recipeId: recipe.recipeId,
      businessCheckId: checkId,
      status: data.content.length === 0 ? 'NO_DATA' : 'PASS',
      checkedAt,
      reasonCode: null,
    };
  }
  if (!Array.isArray(data)) throw new EvidenceBusinessCheckError('BUSINESS_CHECK_RESPONSE_INVALID');
  return {
    source: 'BUSINESS_CHECK',
    recipeId: recipe.recipeId,
    businessCheckId: checkId,
    status: data.length === 0 ? 'NO_DATA' : 'PASS',
    checkedAt,
    reasonCode: null,
  };
}

function normalizeCheckedAt(value: string): string {
  try {
    return parseEvidenceSqlTimestamp(value);
  } catch (error) {
    if (error instanceof EvidenceTypeError) {
      throw new EvidenceBusinessCheckError('BUSINESS_CHECK_INVALID_RECIPE');
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
