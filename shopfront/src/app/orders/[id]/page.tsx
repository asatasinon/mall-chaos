'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Ban, CreditCard, Truck } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cancelOrder, getOrder, money, retryPayment } from '@/lib/api';
import type { Order } from '@/lib/types';
import { ErrorNotice, StatusPill } from '@/components/ui';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => getOrder(id).then(setOrder).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, [id]);
  const cancel = async () => { setBusy(true); try { setOrder(await cancelOrder(Number(id))); } catch (e) { setError(e instanceof Error ? e.message : '订单无法取消'); } finally { setBusy(false); } };
  const retry = async () => { setBusy(true); try { const result = await retryPayment(Number(id)); const paymentId = result.paymentId ?? result.payment?.id; if (paymentId) router.push(`/payment/${paymentId}`); else load(); } catch (e) { setError(e instanceof Error ? e.message : '支付重试暂时失败'); } finally { setBusy(false); } };
  if (!order && !error) return <div className="loading">opening order /</div>;
  return <><Link className="eyebrow" href="/orders"><ArrowLeft size={13} /> back to orders</Link>{error && <ErrorNotice message={error} retry={load} />}{order && <><div className="page-heading" style={{ marginTop: 29 }}><div><span className="eyebrow">order / {order.orderNo}</span><h1>Order story.</h1></div><StatusPill status={order.status} /></div><div className="split-layout"><div><div className="surface"><h2>What you chose</h2>{order.items?.map((item) => <div className="list-row" key={item.sku}><div className="row-grow"><strong>{item.productName ?? item.sku}</strong><small>{item.sku} · {item.quantity} × {money(item.unitPrice)}</small></div><span className="price">{money(item.lineAmount)}</span></div>)}</div><div className="surface"><h2>Delivery</h2><p style={{ color: 'var(--muted)' }}>Address snapshot #{order.addressId ?? '—'}</p>{['FULFILLING', 'SHIPPED', 'COMPLETED'].includes(order.status) && <Link className="btn" href={`/orders/${order.id}/shipment`}>Track shipment <Truck size={15} /></Link>}</div></div><aside className="surface summary"><h2>Order total</h2><div className="summary-line"><span>Subtotal</span><strong>{money(order.subtotal ?? order.amount)}</strong></div><div className="summary-line"><span>Discount</span><strong>-{money(order.discountAmount)}</strong></div><div className="summary-line total"><span>Total</span><strong>{money(order.totalAmount ?? order.amount)}</strong></div>{order.status === 'PENDING_PAYMENT' && <><button className="btn light full" disabled={busy} onClick={retry} style={{ marginTop: 20 }}><CreditCard size={15} /> Pay this order</button><button className="btn danger full" disabled={busy} onClick={cancel} style={{ marginTop: 8 }}><Ban size={15} /> Cancel order</button></>}{order.failReason && <p style={{ color: '#934b3d', fontSize: 12 }}>{order.failReason}</p>}<Link className="btn ghost full" href="/products" style={{ marginTop: 20 }}>Keep browsing <ArrowRight size={15} /></Link></aside></div></>}</>;
}
