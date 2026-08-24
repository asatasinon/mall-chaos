'use client';

import { ArrowRight, CircleCheck, Clock3, RotateCcw, XCircle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { confirmPayment, money, retryPaymentIntent } from '@/lib/api';
import type { Order, Payment } from '@/lib/types';
import { ErrorNotice, StatusPill } from '@/components/ui';

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { const stored = localStorage.getItem(`shopfront-payment:${id}`); if (stored) { const snapshot = JSON.parse(stored) as { payment: Payment; order: Order }; setPayment(snapshot.payment); setOrder(snapshot.order); } else setError('支付会话已过期，请从订单页重新发起支付。'); } catch { setError('支付会话无法恢复，请稍后重试。'); } }, [id]);
  const confirm = async () => { setBusy(true); setError(''); try { const result = await confirmPayment(id); setPayment(result); localStorage.setItem(`shopfront-payment:${id}`, JSON.stringify({ payment: result, order })); } catch (e) { setError(e instanceof Error ? e.message : '支付结果暂时未知，请查询订单'); } finally { setBusy(false); } };
  const retry = async () => { setBusy(true); setError(''); try { setPayment(await retryPaymentIntent(id)); } catch (e) { setError(e instanceof Error ? e.message : '支付重试暂时失败'); } finally { setBusy(false); } };
  if (!payment && !error) return <div className="loading">opening payment /</div>;
  const status = payment?.status ?? 'UNKNOWN';
  const success = status === 'SUCCESS';
  const failed = status === 'FAILED';
  return <div style={{ maxWidth: 680, margin: '0 auto' }}><span className="eyebrow">04 / simulated payment</span><h1 className="page-heading" style={{ display: 'block', margin: '10px 0 30px' }}>A quiet moment before handoff.</h1>{error && <ErrorNotice message={error} />}{payment && <div className="surface" style={{ textAlign: 'center', padding: '46px 28px' }}>{success ? <CircleCheck size={42} color="var(--acid-deep)" /> : failed ? <XCircle size={42} color="var(--coral)" /> : <Clock3 size={42} color="#c79232" />}<h2 style={{ fontSize: 35, marginTop: 18 }}>{success ? 'Payment confirmed' : failed ? 'Payment did not clear' : 'Ready when you are'}</h2><p style={{ color: 'var(--muted)' }}>{payment.paymentNo} · {money(payment.amount)} · {order?.orderNo ?? payment.orderNo}</p><div style={{ margin: '24px 0' }}><StatusPill status={status} /></div>{failed && <p style={{ color: 'var(--muted)' }}>The order remains available when a retry is allowed. No duplicate charge is created by trying again.</p>} {!success && <button className="btn light" disabled={busy} onClick={failed ? retry : confirm}>{busy ? 'Checking…' : failed ? <><RotateCcw size={15} /> Try payment again</> : 'Confirm simulated payment'}</button>}{success && <button className="btn light" onClick={() => router.push('/orders')}>See your order <ArrowRight size={15} /></button>}</div>}</div>;
}
