export type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

export type Page<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
};

export type Product = {
  id: number;
  sku: string;
  name: string;
  price: number | string;
  status: number;
  category?: string;
  mediaUrl?: string;
  availableQty?: number;
};

export type CartItem = { id: number; sku: string; quantity: number };
export type Cart = { id: number; customerId?: number; version: number; items: CartItem[] };

export type OrderItem = {
  sku: string;
  productName?: string;
  quantity: number;
  unitPrice: number | string;
  lineAmount: number | string;
};

export type Order = {
  id: number;
  orderNo: string;
  status: string;
  paymentId?: string | null;
  failReason?: string | null;
  subtotal?: number | string;
  discountAmount?: number | string;
  totalAmount?: number | string;
  amount?: number | string;
  addressId?: number;
  couponId?: number | null;
  version?: number;
  items?: OrderItem[];
};

export type Payment = {
  id: number;
  paymentNo: string;
  orderNo: string;
  amount: number | string;
  status: string;
  resultCode?: string;
  failReason?: string | null;
};

export type Address = {
  id: number;
  province: string;
  city: string;
  district: string;
  detail: string;
  receiver: string;
  phone: string;
  isDefault: boolean;
};

export type Fulfillment = {
  id: number;
  orderId: number;
  orderNo: string;
  status: string;
  trackingNo?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;
  timeline?: { status: string; message: string; occurredAt: string }[];
};

export type Notification = {
  id: number;
  eventType: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  readAt?: string | null;
};

export type NotificationPreferences = { email: boolean; inApp: boolean };
