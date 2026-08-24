import { v4 as uuidv4 } from 'uuid';
import { GatewayClient, getGatewayClient, RunnerRequestContext } from '../lib/gateway-client';
import {
  loadRunnerCustomerIds,
  RunnerOrderRef,
} from '../lib/runner-persistence';
import {
  popPaidOrder,
  popPendingOrder,
  popRunnerOrder,
  pushPaidOrder,
  pushPendingOrder,
  pushRunnerOrder,
} from '../lib/runtime-state';

export const RUNNER_ACTIONS = [
  'BROWSE_PRODUCT',
  'SEARCH_CATALOG',
  'ADD_CART_ITEM',
  'UPDATE_CART_ITEM',
  'CHECKOUT',
  'PAYMENT_CONFIRM',
  'CANCEL_PENDING_ORDER',
  'QUERY_ORDER',
  'QUERY_SHIPMENT',
] as const;

export type RunnerAction = typeof RUNNER_ACTIONS[number];
export type PaymentStrategy = 'SUCCESS' | 'FAILED' | 'UNKNOWN';

export interface RunnerExecutionConfig {
  maxItems: number;
  maxItemQuantity: number;
  paymentSuccessRatio: number;
  paymentFailureRatio: number;
  paymentUnknownRatio: number;
}

export interface RunnerActionResult {
  actionId: string;
  customerId: number;
  traceId: string;
  success: boolean;
  status: 'SUCCESS' | 'FAILED' | 'NOOP';
  resultCode?: string;
  errorCode?: string;
  orderId?: string;
  orderNo?: string;
  paymentId?: string;
  cartVersion?: number;
  paymentStrategy?: PaymentStrategy;
}

interface ApiEnvelope<T> {
  data?: T;
  code?: string | number;
  message?: string;
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

interface OrderData {
  id: number;
  orderNo: string;
  status: string;
  amount?: number | string;
  totalAmount?: number | string;
  paymentId?: string;
}

interface PaymentData {
  id: number;
  orderNo: string;
  status: string;
  resultCode?: string;
}

const SKUS = Array.from({ length: 50 }, (_, index) => `SKU-${String(index + 1).padStart(3, '0')}`);
const CATEGORIES = ['数码', '家居', '运动', '图书', '服饰'];

export class TrafficActionOrchestrator {
  constructor(private readonly gateway: GatewayClient = getGatewayClient()) {}

  async execute(
    action: string,
    trafficRunId: string,
    config: RunnerExecutionConfig = {
      maxItemQuantity: 3,
      maxItems: 3,
      paymentSuccessRatio: 1,
      paymentFailureRatio: 0,
      paymentUnknownRatio: 0,
    },
  ): Promise<RunnerActionResult> {
    const actionId = uuidv4();
    const traceId = uuidv4().replace(/-/g, '');
    let customerId = 0;
    try {
      customerId = await this.selectCustomer();
    } catch (error) {
      return {
        actionId,
        customerId,
        traceId,
        success: false,
        status: 'FAILED',
        errorCode: errorCode(error),
      };
    }
    const context: RunnerRequestContext = {
      customerId,
      trafficRunId,
      action,
      traceId,
      paymentStrategy: action === 'PAYMENT_CONFIRM' ? choosePaymentStrategy(config) : undefined,
    };

    try {
      switch (action as RunnerAction) {
        case 'BROWSE_PRODUCT':
          return this.withBase(actionId, customerId, traceId, await this.browse(context));
        case 'SEARCH_CATALOG':
          return this.withBase(actionId, customerId, traceId, await this.search(context));
        case 'ADD_CART_ITEM':
          return this.withBase(actionId, customerId, traceId, await this.addCartItem(context, config));
        case 'UPDATE_CART_ITEM':
          return this.withBase(actionId, customerId, traceId, await this.updateCartItem(context, config));
        case 'CHECKOUT':
          return this.withBase(actionId, customerId, traceId, await this.checkout(context, config));
        case 'PAYMENT_CONFIRM':
          return this.withBase(actionId, customerId, traceId, await this.confirmPayment(context));
        case 'CANCEL_PENDING_ORDER':
          return this.withBase(actionId, customerId, traceId, await this.cancelPendingOrder(context));
        case 'QUERY_ORDER':
          return this.withBase(actionId, customerId, traceId, await this.queryOrder(context));
        case 'QUERY_SHIPMENT':
          return this.withBase(actionId, customerId, traceId, await this.queryShipment(context));
        default:
          return this.withBase(actionId, customerId, traceId, {
            success: false,
            status: 'FAILED',
            errorCode: 'UNSUPPORTED_RUNNER_ACTION',
          });
      }
    } catch (error) {
      return this.withBase(actionId, customerId, traceId, {
        success: false,
        status: 'FAILED',
        errorCode: errorCode(error),
      });
    }
  }

  private async selectCustomer(): Promise<number> {
    const customers = await loadRunnerCustomerIds();
    return customers[Math.floor(Math.random() * customers.length)];
  }

  private async browse(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const sku = randomItem(SKUS);
    const response = await this.gateway.get<ApiEnvelope<unknown>>(`/api/products/${sku}`, undefined, context);
    return { success: response.data != null, status: response.data != null ? 'SUCCESS' : 'FAILED' };
  }

  private async search(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const response = await this.gateway.get<ApiEnvelope<unknown>>('/api/products', {
      category: randomItem(CATEGORIES),
      page: String(Math.floor(Math.random() * 5)),
      size: '10',
    }, context);
    const data = response.data as { content?: unknown[] } | unknown[] | undefined;
    const items = Array.isArray(data) ? data : data?.content;
    return { success: Array.isArray(items), status: Array.isArray(items) ? 'SUCCESS' : 'FAILED' };
  }

  private async addCartItem(context: RunnerRequestContext, config: RunnerExecutionConfig): Promise<Partial<RunnerActionResult>> {
    const response = await this.gateway.post<ApiEnvelope<CartData>>('/api/cart/items', {
      sku: randomItem(SKUS),
      quantity: randomQuantity(config.maxItemQuantity),
    }, context);
    return this.cartResult(response);
  }

  private async updateCartItem(context: RunnerRequestContext, config: RunnerExecutionConfig): Promise<Partial<RunnerActionResult>> {
    const cart = await this.gateway.get<ApiEnvelope<CartData>>('/api/cart', undefined, context);
    const item = cart.data?.items?.[Math.floor(Math.random() * (cart.data.items.length || 1))];
    if (!item) return { success: true, status: 'NOOP', resultCode: 'CART_EMPTY' };
    const response = await this.gateway.patch<ApiEnvelope<CartData>>(`/api/cart/items/${item.id}`, {
      quantity: randomQuantity(config.maxItemQuantity),
    }, context);
    return this.cartResult(response);
  }

  private async checkout(context: RunnerRequestContext, config: RunnerExecutionConfig): Promise<Partial<RunnerActionResult>> {
    let cartResponse = await this.gateway.get<ApiEnvelope<CartData>>('/api/cart', undefined, context);
    if (!cartResponse.data?.items?.length) {
      await this.gateway.post('/api/cart/items', { sku: randomItem(SKUS), quantity: randomQuantity(config.maxItemQuantity) }, context);
      cartResponse = await this.gateway.get<ApiEnvelope<CartData>>('/api/cart', undefined, context);
    }
    const targetItemCount = Math.min(Math.max(Math.floor(config.maxItems), 1), SKUS.length);
    let attempts = 0;
    while (cartResponse.data && cartResponse.data.items.length < targetItemCount && attempts < targetItemCount * 2) {
      const existingSkus = new Set(cartResponse.data.items.map((item) => item.sku));
      const availableSkus = SKUS.filter((sku) => !existingSkus.has(sku));
      if (availableSkus.length === 0) break;
      await this.gateway.post('/api/cart/items', {
        sku: randomItem(availableSkus),
        quantity: randomQuantity(config.maxItemQuantity),
      }, context);
      cartResponse = await this.gateway.get<ApiEnvelope<CartData>>('/api/cart', undefined, context);
      attempts++;
    }
    const cart = cartResponse.data;
    if (!cart?.items?.length) return { success: false, status: 'FAILED', errorCode: 'CART_EMPTY' };

    const addresses = await this.gateway.get<ApiEnvelope<AddressData[]>>('/api/addresses', undefined, context);
    const address = addresses.data?.find((item) => item.isDefault === true || item.isDefault === 1)
      ?? addresses.data?.[0];
    if (!address?.id) return { success: false, status: 'FAILED', errorCode: 'ADDRESS_NOT_FOUND' };

    const response = await this.gateway.post<ApiEnvelope<OrderData>>('/api/checkout', {
      cartId: cart.id,
      cartVersion: cart.version,
      addressId: address.id,
      idempotencyKey: `runner-checkout-${context.trafficRunId}-${uuidv4()}`,
    }, context);
    const order = response.data;
    if (!order?.id || order.status !== 'PENDING_PAYMENT') {
      return { success: false, status: 'FAILED', errorCode: response.code?.toString() || 'CHECKOUT_FAILED' };
    }
    const orderRef: RunnerOrderRef = {
      customerId: context.customerId,
      orderId: String(order.id),
      orderNo: order.orderNo,
    };
    await pushPendingOrder(orderRef);
    await pushRunnerOrder(orderRef);
    return {
      success: true,
      status: 'SUCCESS',
      orderId: String(order.id),
      orderNo: order.orderNo,
      cartVersion: cart.version,
    };
  }

  private async confirmPayment(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const orderRef = await popPendingOrder();
    if (!orderRef) return { success: true, status: 'NOOP', resultCode: 'NO_PENDING_ORDER' };
    const orderResponse = await this.gateway.get<ApiEnvelope<OrderData>>(`/api/orders/${orderRef.orderId}`, undefined, contextFor(context, orderRef.customerId));
    const order = orderResponse.data;
    if (!order || order.status !== 'PENDING_PAYMENT') {
      if (order?.status === 'PAID' || order?.status === 'FULFILLING' || order?.status === 'SHIPPED' || order?.status === 'COMPLETED') {
        await pushPaidOrder({ ...orderRef, orderNo: order.orderNo });
      }
      return { customerId: orderRef.customerId, success: true, status: 'NOOP', resultCode: `ORDER_${order?.status || 'MISSING'}` };
    }
    const paymentIntent = await this.gateway.post<ApiEnvelope<PaymentData>>('/api/payments/intents', {
      orderNo: order.orderNo,
      amount: order.totalAmount ?? order.amount,
      idempotencyKey: `runner-payment-${order.id}`,
    }, contextFor(context, orderRef.customerId));
    const payment = paymentIntent.data;
    if (!payment?.id) {
      await pushPendingOrder(orderRef);
      return { success: false, status: 'FAILED', errorCode: 'PAYMENT_INTENT_FAILED', orderId: orderRef.orderId };
    }
    const confirmed = await this.gateway.post<ApiEnvelope<PaymentData>>(`/api/payments/${payment.id}/confirm`, {}, contextFor(context, orderRef.customerId));
    const result = confirmed.data;
    const base = {
      customerId: orderRef.customerId,
      orderId: orderRef.orderId,
      orderNo: order.orderNo,
      paymentId: String(payment.id),
      paymentStrategy: result?.status === 'SUCCESS' ? 'SUCCESS' : result?.status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED' as PaymentStrategy,
    };
    if (result?.status === 'SUCCESS') {
      await pushPaidOrder({ ...orderRef, orderNo: order.orderNo, paymentId: String(payment.id) });
      return { ...base, success: true, status: 'SUCCESS', resultCode: result.resultCode };
    }
    if (result?.status === 'UNKNOWN') await pushPendingOrder(orderRef);
    return { ...base, success: result?.status === 'UNKNOWN', status: result?.status === 'UNKNOWN' ? 'NOOP' : 'FAILED', resultCode: result?.resultCode || 'PAYMENT_FAILED' };
  }

  private async cancelPendingOrder(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const orderRef = await popPendingOrder();
    if (!orderRef) return { success: true, status: 'NOOP', resultCode: 'NO_PENDING_ORDER' };
    const scopedContext = contextFor(context, orderRef.customerId);
    const orderResponse = await this.gateway.get<ApiEnvelope<OrderData>>(`/api/orders/${orderRef.orderId}`, undefined, scopedContext);
    if (orderResponse.data?.status !== 'PENDING_PAYMENT') {
      if (orderResponse.data && ['PAID', 'FULFILLING', 'SHIPPED', 'COMPLETED'].includes(orderResponse.data.status)) {
        await pushPaidOrder({ ...orderRef, orderNo: orderResponse.data.orderNo });
      }
      return { customerId: orderRef.customerId, success: true, status: 'NOOP', resultCode: `ORDER_${orderResponse.data?.status || 'MISSING'}` };
    }
    const response = await this.gateway.post<ApiEnvelope<OrderData>>(`/api/orders/${orderRef.orderId}/cancel`, {}, scopedContext);
    return {
      success: response.data?.status === 'CANCELLED',
      status: response.data?.status === 'CANCELLED' ? 'SUCCESS' : 'FAILED',
      customerId: orderRef.customerId,
      orderId: orderRef.orderId,
      resultCode: response.data?.status,
    };
  }

  private async queryOrder(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const orderRef = await popRunnerOrder();
    if (!orderRef) return { success: true, status: 'NOOP', resultCode: 'NO_RECORDED_ORDER' };
    await pushRunnerOrder(orderRef);
    const response = await this.gateway.get<ApiEnvelope<OrderData>>(`/api/orders/${orderRef.orderId}`, undefined, contextFor(context, orderRef.customerId));
    return {
      success: response.data != null,
      status: response.data != null ? 'SUCCESS' : 'FAILED',
      customerId: orderRef.customerId,
      orderId: orderRef.orderId,
      orderNo: response.data?.orderNo,
    };
  }

  private async queryShipment(context: RunnerRequestContext): Promise<Partial<RunnerActionResult>> {
    const orderRef = await popPaidOrder();
    if (!orderRef) return { success: true, status: 'NOOP', resultCode: 'NO_PAID_ORDER' };
    await pushPaidOrder(orderRef);
    const response = await this.gateway.get<ApiEnvelope<unknown>>(`/api/fulfillments/${orderRef.orderId}`, undefined, contextFor(context, orderRef.customerId));
    return {
      success: response.data != null,
      status: response.data != null ? 'SUCCESS' : 'NOOP',
      customerId: orderRef.customerId,
      orderId: orderRef.orderId,
      resultCode: response.data != null ? undefined : 'SHIPMENT_NOT_READY',
    };
  }

  private cartResult(response: ApiEnvelope<CartData>): Partial<RunnerActionResult> {
    return {
      success: response.data != null,
      status: response.data != null ? 'SUCCESS' : 'FAILED',
      cartVersion: response.data?.version,
    };
  }

  private withBase(actionId: string, customerId: number, traceId: string, result: Partial<RunnerActionResult>): RunnerActionResult {
    return { actionId, customerId, traceId, success: false, status: 'FAILED', ...result };
  }
}

function contextFor(context: RunnerRequestContext, customerId: number): RunnerRequestContext {
  return { ...context, customerId };
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomQuantity(maximum: number): number {
  return Math.floor(Math.random() * Math.max(maximum, 1)) + 1;
}

export function choosePaymentStrategy(config: RunnerExecutionConfig): PaymentStrategy {
  const total = Math.max(config.paymentSuccessRatio + config.paymentFailureRatio + config.paymentUnknownRatio, 0.0001);
  const roll = Math.random() * total;
  if (roll < config.paymentSuccessRatio) return 'SUCCESS';
  if (roll < config.paymentSuccessRatio + config.paymentFailureRatio) return 'FAILED';
  return 'UNKNOWN';
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/failed \(\d+\): .*?"code"\s*:\s*"?([A-Z0-9_]+)/i);
    return match?.[1] || 'RUNNER_GATEWAY_ERROR';
  }
  return 'RUNNER_ACTION_FAILED';
}
