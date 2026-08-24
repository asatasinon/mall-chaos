'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkout, createPaymentIntent, getAddresses, getCart, getProduct, money } from '@/lib/api';
import type { Address, Cart, Product } from '@/lib/types';
import { ErrorNotice, EmptyState } from '@/components/ui';
import { useRouter } from 'next/navigation';

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addressId, setAddressId] = useState('');
  const [couponId, setCouponId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.all([getCart(), getAddresses()]).then(([nextCart, nextAddresses]) => { setCart(nextCart); setAddresses(nextAddresses); setAddressId(String(nextAddresses.find((address) => address.isDefault)?.id ?? nextAddresses[0]?.id ?? '')); return Promise.all(nextCart.items.map((item) => getProduct(item.sku))); }).then((result) => { if (result) setProducts(result as Product[]); }).catch((e: Error) => setError(e.message)); }, []);
  const subtotal = cart?.items.reduce((sum, item) => sum + Number(products.find((product) => product.sku === item.sku)?.price ?? 0) * item.quantity, 0) ?? 0;
  const submit = async () => {
    if (!cart || !addressId) { setError('请选择一个收货地址后继续。'); return; }
    setBusy(true); setError('');
    try {
      const order = await checkout({ cartId: cart.id, cartVersion: cart.version, addressId: Number(addressId), ...(couponId ? { couponId: Number(couponId) } : {}), idempotencyKey: `shopfront-checkout-${crypto.randomUUID()}` });
      const payment = await createPaymentIntent(order.orderNo, Number(order.totalAmount ?? order.amount ?? subtotal), `shopfront-payment-${order.orderNo}`);
      localStorage.setItem(`shopfront-payment:${payment.id}`, JSON.stringify({ payment, order }));
      router.push(`/payment/${payment.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : '结算暂时失败，请稍后重试'); } finally { setBusy(false); }
  };
  if (!cart && !error) return <div className="loading">preparing checkout /</div>;
  if (cart?.items.length === 0) return <EmptyState title="Your basket is empty" body="Add at least one object before settling the basket." href="/products" />;
  return <><Link className="eyebrow" href="/cart"><ArrowLeft size={13} /> back to basket</Link><div className="page-heading" style={{ marginTop: 30 }}><div><span className="eyebrow">03 / checkout</span><h1>Make it yours.</h1></div><p>Prices and availability are checked by the services again at this point. The basket version is <span className="price">{cart?.version}</span>.</p></div>{error && <ErrorNotice message={error} />}{cart && <div className="split-layout"><div className="surface"><h2>Delivery address</h2>{addresses.length ? <div className="form-grid">{addresses.map((address) => <label className="list-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} key={address.id}><input type="radio" name="address" value={address.id} checked={addressId === String(address.id)} onChange={(event) => setAddressId(event.target.value)} /><span className="row-grow"><strong>{address.receiver} {address.isDefault && <span className="eyebrow">default</span>}</strong><small>{address.phone} · {address.province} {address.city} {address.district} {address.detail}</small></span></label>)}</div> : <div className="notice">还没有可用地址。请先在账户页添加一个地址。</div>}<h2 style={{ marginTop: 36 }}>Promotion</h2><div className="field"><label htmlFor="coupon">Coupon ID (optional)</label><input className="input" id="coupon" value={couponId} onChange={(event) => setCouponId(event.target.value.replace(/\D/g, ''))} placeholder="Leave blank to continue without one" /></div><div className="notice" style={{ marginTop: 25 }}><LockKeyhole size={15} /> We never accept browser-submitted prices as payment authority.</div></div><aside className="surface summary"><h2>Settle basket</h2>{cart.items.map((item) => <div className="summary-line" key={item.id}><span>{item.sku} × {item.quantity}</span><strong>{money(Number(products.find((product) => product.sku === item.sku)?.price ?? 0) * item.quantity)}</strong></div>)}<div className="summary-line total"><span>Estimated total</span><strong>{money(subtotal)}</strong></div><button className="btn light full" disabled={busy || !addresses.length} onClick={submit}>{busy ? 'Creating order…' : 'Create pending order'} <ArrowRight size={15} /></button></aside></div>}</>;
}
