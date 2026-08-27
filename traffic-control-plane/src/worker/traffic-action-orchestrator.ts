import { v4 as uuidv4 } from 'uuid';
import {
  CustomerRequestContext,
  GatewayClient,
  getGatewayClient,
} from '../lib/gateway-client';
import {
  recordTrafficAction,
  recordTrafficLifecycle,
  TrafficActionRecord,
  TrafficLifecycleRecord,
} from '../lib/runner-persistence';
import { CustomerSessionManager } from './customer-session-manager';

export interface RunnerExecutionConfig {
  maxItems: number;
  maxItemQuantity: number;
  paymentSuccessRatio: number;
  couponUsageRatio?: number;
}

export interface LifecycleStepResult {
  actionId: string;
  lifecycleId: string;
  actionType: string;
  status: 'SUCCESS' | 'FAILED' | 'NOOP' | 'INTERRUPTED';
  success: boolean;
  resultCode?: string;
  errorCode?: string;
  orderId?: string;
  paymentId?: string;
  cartVersion?: number;
  latencyMs: number;
}

export interface RunnerActionResult {
  actionId: string;
  lifecycleId?: string;
  customerId: number;
  traceId: string;
  success: boolean;
  status: 'SUCCESS' | 'FAILED' | 'NOOP' | 'INTERRUPTED';
  resultCode?: string;
  errorCode?: string;
  orderId?: string;
  orderNo?: string;
  paymentId?: string;
  cartVersion?: number;
  pendingPaymentRetained?: boolean;
  steps?: LifecycleStepResult[];
}

interface ApiEnvelope<T> {
  data?: T;
  code?: string | number;
}

interface ProductData {
  sku: string;
  price?: number | string;
  status?: number | boolean;
  availableQty?: number;
}

interface ProductPage {
  content?: ProductData[];
}

interface CartData {
  id: number;
  version: number;
  items: Array<{ id: number; sku: string; quantity: number }>;
}

interface AddressData {
  id: number;
  isDefault?: boolean | number;
}

interface CouponData {
  id: number;
  minAmount?: number | string;
  expireAt?: string;
}

interface OrderData {
  id: number;
  orderNo: string;
  status: string;
}

interface PaymentData {
  id: number;
  status: string;
}

interface StepValue<T> {
  status: 'SUCCESS' | 'FAILED' | 'NOOP' | 'INTERRUPTED';
  success: boolean;
  value?: T;
  resultCode?: string;
  errorCode?: string;
}

export interface LifecycleExecutionOptions {
  signal?: AbortSignal;
}

interface LifecyclePersistence {
  recordTrafficAction: (record: TrafficActionRecord) => Promise<void>;
  recordTrafficLifecycle: (record: TrafficLifecycleRecord) => Promise<void>;
}

export class TrafficActionOrchestrator {
  private readonly gateway: GatewayClient;
  private readonly sessions: CustomerSessionManager;
  private readonly persistence: LifecyclePersistence;
  private currentTrafficRunId = '';
  private currentTraceId = '';
  private currentCustomerId = 0;

  constructor(
    gateway: GatewayClient = getGatewayClient(),
    sessions: CustomerSessionManager = new CustomerSessionManager({ gateway }),
    persistence: LifecyclePersistence = { recordTrafficAction, recordTrafficLifecycle },
  ) {
    this.gateway = gateway;
    this.sessions = sessions;
    this.persistence = persistence;
  }

  async executeLifecycle(
    trafficRunId: string,
    config: RunnerExecutionConfig,
    options: LifecycleExecutionOptions = {},
  ): Promise<RunnerActionResult> {
    const lifecycleId = uuidv4();
    const traceId = uuidv4().replace(/-/g, '');
    const steps: LifecycleStepResult[] = [];
    let context: CustomerRequestContext | null = null;
    let customerId = 0;
    let order: OrderData | undefined;
    let paymentId: string | undefined;
    let pendingPaymentRetained = false;
    const startedAt = Date.now();
    this.currentTrafficRunId = trafficRunId;
    this.currentTraceId = traceId;
    this.currentCustomerId = 0;

    try {
      context = await this.sessions.openSession(trafficRunId, lifecycleId, traceId);
      customerId = context.session.customerId;
      this.currentCustomerId = customerId;
      await this.recordStep(steps, lifecycleId, 'LOGIN', 'SUCCESS', true);
      this.throwIfInterrupted(options.signal);

      const products = await this.runStep(steps, lifecycleId, 'BROWSE_CATALOG', options, () =>
        this.findSellableProducts(context!, options.signal));
      if (products.status === 'NOOP') {
        return this.finish(lifecycleId, customerId, traceId, steps, 'NOOP', products.resultCode,
          Date.now() - startedAt);
      }
      this.throwIfInterrupted(options.signal);

      const initialCart = await this.runStep(steps, lifecycleId, 'CART_READ_INITIAL', options, () =>
        this.gateway.customerGet<ApiEnvelope<CartData>>('/api/cart', undefined, context!));
      const cart = initialCart.value?.data;
      if (!cart) throw new Error('CART_READ_FAILED');

      const selected = this.selectProducts(products.value ?? [], cart, config.maxItems);
      if (selected.length === 0) {
        await this.recordStep(steps, lifecycleId, 'CART_REUSED', 'NOOP', true, 'CART_REUSED');
      } else {
        for (const product of selected) {
          this.throwIfInterrupted(options.signal);
          const added = await this.runStep(steps, lifecycleId, 'ADD_CART_ITEM', options, () =>
            this.gateway.customerPost<ApiEnvelope<CartData>>('/api/cart/items', {
              sku: product.sku,
              quantity: randomQuantity(config.maxItemQuantity),
            }, context!));
          if (!added.value?.data) throw new Error('ADD_CART_FAILED');
        }
      }

      const readyCartResult = await this.runStep(steps, lifecycleId, 'CART_READ_READY', options, () =>
        this.gateway.customerGet<ApiEnvelope<CartData>>('/api/cart', undefined, context!));
      const readyCart = readyCartResult.value?.data;
      if (!readyCart?.items?.length) throw new Error('CART_EMPTY');
      steps[steps.length - 1].cartVersion = readyCart.version;

      const addresses = await this.runStep(steps, lifecycleId, 'ADDRESS_READ', options, () =>
        this.gateway.customerGet<ApiEnvelope<AddressData[]>>('/api/me/addresses', undefined, context!));
      let address = addresses.value?.data?.find((item) => item.isDefault === true || item.isDefault === 1)
        ?? addresses.value?.data?.[0];
      if (!address?.id) {
        const created = await this.runStep(steps, lifecycleId, 'ADDRESS_CREATE', options, () =>
          this.gateway.customerPost<ApiEnvelope<AddressData>>('/api/me/addresses', {
            province: 'Shanghai', city: 'Shanghai', district: 'Pudong New Area',
            detail: `Demo Customer${customerId}default address`, receiver: `Demo Customer${customerId}`,
            phone: '13800138000', isDefault: true,
          }, context!));
        address = created.value?.data;
      }
      if (!address?.id) throw new Error('ADDRESS_NOT_FOUND');
      this.throwIfInterrupted(options.signal);

      let couponId: number | undefined;
      if (Math.random() < (config.couponUsageRatio ?? 0)) {
        const cartTotal = await this.runStep(steps, lifecycleId, 'CART_TOTAL_READ', options, () =>
          this.estimateCartTotal(readyCart, products.value ?? [], context!));
        const coupon = await this.runStep(steps, lifecycleId, 'COUPON_SELECT', options, async () => {
          const response = await this.gateway.customerGet<ApiEnvelope<CouponData[]>>(
            '/api/me/coupons', { status: 'AVAILABLE' }, context!);
          const candidates = (response.data ?? []).filter((item) =>
            (item.expireAt === undefined || new Date(item.expireAt).getTime() > Date.now())
              && Number(item.minAmount ?? 0) <= (cartTotal.value ?? 0));
          const chosen = candidates[Math.floor(Math.random() * candidates.length)];
          return chosen
            ? { status: 'SUCCESS' as const, success: true, value: chosen }
            : { status: 'NOOP' as const, success: true, resultCode: 'COUPON_UNAVAILABLE' };
        });
        couponId = coupon.value?.id;
      } else {
        await this.recordStep(steps, lifecycleId, 'COUPON_SELECT', 'NOOP', true,
          'NO_COUPON_REQUESTED');
      }

      const checkout = await this.runStep(steps, lifecycleId, 'CHECKOUT', options, () =>
        this.gateway.customerPost<ApiEnvelope<OrderData>>('/api/checkout', {
          cartId: readyCart.id,
          cartVersion: readyCart.version,
          addressId: address!.id,
          ...(couponId === undefined ? {} : { couponId }),
          idempotencyKey: `lifecycle-checkout-${lifecycleId}`,
        }, context!));
      order = checkout.value?.data;
      if (!order?.id || order.status !== 'PENDING_PAYMENT') throw new Error('CHECKOUT_NOT_PENDING_PAYMENT');
      pendingPaymentRetained = true;

      const createdOrder = await this.runStep(steps, lifecycleId, 'QUERY_CREATED_ORDER', options, () =>
        this.gateway.customerGet<ApiEnvelope<OrderData>>(`/api/orders/${order!.id}`, undefined, context!));
      if (createdOrder.value?.data?.status !== 'PENDING_PAYMENT') throw new Error('CREATED_ORDER_NOT_PENDING_PAYMENT');

      this.throwIfInterrupted(options.signal);
      if (Math.random() < config.paymentSuccessRatio) {
        const intent = await this.runStep(steps, lifecycleId, 'PAYMENT_INTENT', options, () =>
          this.gateway.customerPost<ApiEnvelope<PaymentData>>(`/api/orders/${order!.id}/payment-intents`, {
            idempotencyKey: `lifecycle-payment-${lifecycleId}`,
          }, context!));
        paymentId = intent.value?.data?.id === undefined ? undefined : String(intent.value.data.id);
        if (!paymentId) throw new Error('PAYMENT_INTENT_FAILED');
        const confirmation = await this.runStep(steps, lifecycleId, 'PAYMENT_CONFIRM', options, () =>
          this.gateway.customerPost<ApiEnvelope<PaymentData>>(`/api/payments/${paymentId}/confirm`, {}, context!));
        if (confirmation.value?.data?.status !== 'SUCCESS') throw new Error('CUSTOMER_PAYMENT_FAILED');
        pendingPaymentRetained = false;
      } else {
        const beforeCancel = await this.runStep(steps, lifecycleId, 'QUERY_BEFORE_CANCEL', options, () =>
          this.gateway.customerGet<ApiEnvelope<OrderData>>(`/api/orders/${order!.id}`, undefined, context!));
        if (beforeCancel.value?.data?.status === 'PENDING_PAYMENT') {
          const cancelled = await this.runStep(steps, lifecycleId, 'CANCEL_PENDING_ORDER', options, () =>
            this.gateway.customerPost<ApiEnvelope<OrderData>>(`/api/orders/${order!.id}/cancel`, {}, context!));
          if (cancelled.value?.data?.status === 'CANCELLED') pendingPaymentRetained = false;
        } else {
          await this.recordStep(steps, lifecycleId, 'CANCEL_PENDING_ORDER', 'NOOP', true,
            `ORDER_${beforeCancel.value?.data?.status ?? 'MISSING'}`, String(order.id));
        }
      }

      const finalOrder = await this.runStep(steps, lifecycleId, 'QUERY_FINAL_ORDER', options, () =>
        this.gateway.customerGet<ApiEnvelope<OrderData>>(`/api/orders/${order!.id}`, undefined, context!));
      if (!finalOrder.value?.data) throw new Error('FINAL_ORDER_QUERY_FAILED');
      return this.finish(lifecycleId, customerId, traceId, steps, 'SUCCESS', finalOrder.value?.data?.status,
        Date.now() - startedAt, order, pendingPaymentRetained, paymentId);
    } catch (error) {
      const interrupted = error instanceof Error && error.message === 'LIFECYCLE_INTERRUPTED';
      if (context) {
        await this.recordStep(steps, lifecycleId, 'LIFECYCLE_INTERRUPTED',
          interrupted ? 'INTERRUPTED' : 'FAILED', false, errorCode(error),
          order?.id === undefined ? undefined : String(order.id));
      }
      return this.finish(lifecycleId, customerId, traceId, steps, interrupted ? 'INTERRUPTED' : 'FAILED',
        undefined, Date.now() - startedAt, order, pendingPaymentRetained, paymentId,
        errorCode(error));
    } finally {
      if (context) await this.sessions.closeSession(lifecycleId, traceId);
      this.currentCustomerId = 0;
      this.currentTrafficRunId = '';
      this.currentTraceId = '';
    }
  }

  private async findSellableProducts(
    context: CustomerRequestContext,
    signal?: AbortSignal,
  ): Promise<StepValue<ProductData[]>> {
    const products: ProductData[] = [];
    for (let page = 0; page < 3; page++) {
      this.throwIfInterrupted(signal);
      const response = await this.gateway.customerGet<ApiEnvelope<ProductPage>>('/api/products', {
        page: String(page), size: '20', sort: 'latest',
      }, context);
      products.push(...(response.data?.content ?? []));
      if ((response.data?.content?.length ?? 0) < 20) break;
    }
    const sellable = products.filter((product) => product.sku
      && product.status === 1
      && typeof product.availableQty === 'number'
      && product.availableQty > 0
      && Number(product.price) > 0);
    return sellable.length > 0
      ? { status: 'SUCCESS', success: true, value: sellable }
      : { status: 'NOOP', success: true, resultCode: 'NO_SELLABLE_PRODUCT' };
  }

  private selectProducts(products: ProductData[], cart: CartData, maximum: number): ProductData[] {
    const existing = new Set(cart.items.map((item) => item.sku));
    const available = products.filter((product) => !existing.has(product.sku));
    if (cart.items.length >= maximum || available.length === 0) return [];
    const count = Math.floor(Math.random() * Math.min(maximum - cart.items.length, available.length)) + 1;
    return [...available].sort(() => Math.random() - 0.5).slice(0, count);
  }

  private async estimateCartTotal(
    cart: CartData,
    products: ProductData[],
    context: CustomerRequestContext,
  ): Promise<number> {
    const knownPrices = new Map(products.map((product) => [product.sku, Number(product.price)]));
    let total = 0;
    for (const item of cart.items) {
      let price = knownPrices.get(item.sku);
      if (price === undefined) {
        const response = await this.gateway.customerGet<ApiEnvelope<ProductData>>(
          `/api/products/${encodeURIComponent(item.sku)}`, undefined, context);
        price = Number(response.data?.price);
      }
      if (!Number.isFinite(price) || price <= 0) throw new Error('PRODUCT_PRICE_UNAVAILABLE');
      total += price * item.quantity;
    }
    return total;
  }

  private async runStep<T>(
    steps: LifecycleStepResult[],
    lifecycleId: string,
    actionType: string,
    options: LifecycleExecutionOptions,
    operation: () => Promise<T | StepValue<T>>,
  ): Promise<StepValue<T>> {
    const startedAt = Date.now();
    try {
      const raw = await operation();
      const outcome = isStepValue(raw) ? raw : { status: 'SUCCESS' as const, success: true, value: raw };
      await this.recordStep(steps, lifecycleId, actionType, outcome.status, outcome.success,
        outcome.resultCode, undefined, undefined, Date.now() - startedAt,
        outcome.errorCode);
      return outcome;
    } catch (error) {
      await this.recordStep(steps, lifecycleId, actionType, 'FAILED', false, errorCode(error),
        undefined, undefined, Date.now() - startedAt, errorCode(error));
      throw error;
    }
  }

  private async recordStep(
    steps: LifecycleStepResult[],
    lifecycleId: string,
    actionType: string,
    status: LifecycleStepResult['status'],
    success: boolean,
    resultCode?: string,
    orderId?: string,
    paymentId?: string,
    latencyMs = 0,
    errorCodeValue?: string,
  ): Promise<void> {
    const step: LifecycleStepResult = {
      actionId: uuidv4(), lifecycleId, actionType, status, success, resultCode,
      errorCode: errorCodeValue, orderId, paymentId, latencyMs,
    };
    steps.push(step);
    if (this.currentCustomerId > 0) {
      await this.persistence.recordTrafficAction({
        trafficRunId: this.currentTrafficRunId, lifecycleId, actionId: step.actionId,
        customerId: this.currentCustomerId, actionType,
        status: status === 'INTERRUPTED' ? 'FAILED' : status,
        orderId, paymentId, resultCode, errorCode: errorCodeValue,
        traceId: this.currentTraceId, latencyMs,
      }).catch(() => undefined);
    }
  }

  private async finish(
    lifecycleId: string,
    customerId: number,
    traceId: string,
    steps: LifecycleStepResult[],
    status: RunnerActionResult['status'],
    resultCode?: string,
    _latencyMs = 0,
    order?: OrderData,
    pendingPaymentRetained = false,
    paymentId?: string,
    errorCodeValue?: string,
  ): Promise<RunnerActionResult> {
    const result: RunnerActionResult = {
      actionId: uuidv4(), lifecycleId, customerId, traceId,
      success: status === 'SUCCESS' || status === 'NOOP', status, resultCode,
      errorCode: errorCodeValue, orderId: order?.id === undefined ? undefined : String(order.id),
      orderNo: order?.orderNo, paymentId, pendingPaymentRetained, steps,
      cartVersion: steps.findLast((step) => step.actionType === 'CART_READ_READY')?.cartVersion,
    };
    if (customerId > 0) {
      await this.persistence.recordTrafficLifecycle({
        trafficRunId: this.currentTrafficRunId, lifecycleId, actionId: result.actionId,
        customerId, status: status === 'INTERRUPTED' ? 'FAILED' : status,
        orderId: result.orderId, paymentId, cartVersion: result.cartVersion,
        resultCode, errorCode: errorCodeValue,
        traceId, latencyMs: _latencyMs,
      }).catch(() => undefined);
    }
    return result;
  }

  private throwIfInterrupted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('LIFECYCLE_INTERRUPTED');
  }
}

function isStepValue<T>(value: T | StepValue<T>): value is StepValue<T> {
  return Boolean(value && typeof value === 'object' && 'status' in value && 'success' in value);
}

function randomQuantity(maximum: number): number {
  return Math.floor(Math.random() * Math.max(maximum, 1)) + 1;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'LIFECYCLE_FAILED';
}
