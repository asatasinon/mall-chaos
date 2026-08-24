import type { Address, ApiResponse, Cart, CartItem, Fulfillment, Notification, Order, Page, Payment, Product } from './types';
import type { AuthSession } from './auth';

export class ShopApiError extends Error {
  code: number;
  status: number;

  constructor(message: string, code = 500, status = 500) {
    super(message);
    this.name = 'ShopApiError';
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new ShopApiError(payload?.message ?? '服务暂时不可用，请稍后重试', payload?.code, response.status);
  }
  return payload.data;
}

export function createClientRequestId(prefix: string) {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return `${prefix}-${webCrypto.randomUUID()}`;
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    const values = new Uint32Array(4);
    webCrypto.getRandomValues(values);
    return `${prefix}-${Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const getProducts = (query = '') => api<Page<Product>>(`products${query}`);
export const getProduct = (sku: string) => api<Product>(`products/${encodeURIComponent(sku)}`);
export const getCart = () => api<Cart>('cart');
export const addCartItem = (sku: string, quantity: number) =>
  api<Cart>('cart/items', { method: 'POST', body: JSON.stringify({ sku, quantity }) });
export const updateCartItem = (id: number, sku: string, quantity: number) =>
  api<Cart>(`cart/items/${id}`, { method: 'PATCH', body: JSON.stringify({ sku, quantity }) });
export const removeCartItem = (id: number) => api<Cart>(`cart/items/${id}`, { method: 'DELETE' });
export const clearCart = () => api<Cart>('cart', { method: 'DELETE' });
export const getOrders = (page = 0) => api<Page<Order>>(`orders?page=${page}&size=20`);
export const getOrder = (id: string | number) => api<Order>(`orders/${id}`);
export const cancelOrder = (id: number) => api<Order>(`orders/${id}/cancel`, { method: 'POST' });
export const retryPayment = (id: number) => api<{ paymentId?: number; payment?: Payment }>(`orders/${id}/payment-retry`, { method: 'POST' });
export const createPaymentIntent = (orderNo: string, amount: number, idempotencyKey: string) =>
  api<Payment>('payments/intents', { method: 'POST', body: JSON.stringify({ orderNo, amount, idempotencyKey }) });
export const confirmPayment = (id: string | number) => api<Payment>(`payments/${id}/confirm`, { method: 'POST' });
export const retryPaymentIntent = (id: string | number) => api<Payment>(`payments/${id}/retry`, { method: 'POST' });
export const checkout = (payload: { cartId: number; cartVersion: number; addressId: number; couponId?: number; idempotencyKey: string }) =>
  api<Order>('checkout', { method: 'POST', body: JSON.stringify(payload) });
export const getFulfillment = (orderId: string | number) => api<Fulfillment>(`fulfillments/${orderId}`);
export const confirmDelivery = (orderId: number) => api<Fulfillment>(`fulfillments/${orderId}/confirm-delivery`, { method: 'POST' });
export const getNotifications = (page = 0) => api<Page<Notification>>(`notifications?page=${page}&size=20`);
export const markNotificationRead = (id: number) => api<Notification>(`notifications/${id}/read`, { method: 'PATCH' });
export const getAddresses = () => api<Address[]>('addresses');

export function money(value: number | string | undefined | null) {
  return `¥${Number(value ?? 0).toFixed(2)}`;
}

export function cartQuantity(cart: Cart | null) {
  return cart?.items.reduce((total: number, item: CartItem) => total + item.quantity, 0) ?? 0;
}

export const register = (payload: { email: string; password: string; nickname: string }) =>
  api<AuthSession>('auth/register', { method: 'POST', body: JSON.stringify(payload) });
export const login = (payload: { email: string; password: string }) =>
  api<AuthSession>('auth/login', { method: 'POST', body: JSON.stringify(payload) });
export const refreshSession = () => api<AuthSession>('auth/refresh', { method: 'POST' });
export const logout = () => api<void>('auth/logout', { method: 'POST' });

export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as ApiResponse<AuthSession> | null;
  return payload?.code === 200 ? payload.data : null;
}
