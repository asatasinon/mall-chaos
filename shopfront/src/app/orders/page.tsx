'use client';

import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getOrders, money } from '@/lib/api';
import type { Order, Page } from '@/lib/types';
import { EmptyState, ErrorNotice, StatusPill } from '@/components/ui';

export default function OrdersPage() {
  const [page, setPage] = useState<Page<Order> | null>(null);
  const [error, setError] = useState('');
  const load = () => getOrders().then(setPage).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  return <><div className="page-heading"><div><span className="eyebrow">05 / order log</span><h1>Your orders.</h1></div><p>Every order keeps its own price, address and fulfillment story, even as the catalog moves on.</p></div>{error && <ErrorNotice message={error} retry={load} />}{page?.content.length === 0 && <EmptyState title="No orders yet" body="Your first good decision can start in the catalog." href="/products" />}{page?.content.length ? <div className="surface">{page.content.map((order) => <Link className="list-row" href={`/orders/${order.id}`} key={order.id}><div className="mini-art">{String(order.id).slice(-2)}</div><div className="row-grow"><strong>{order.orderNo}</strong><small>{order.items?.length ?? 0} line items · {money(order.totalAmount ?? order.amount)}</small></div><StatusPill status={order.status} /><ArrowRight size={16} color="var(--muted)" /></Link>)}</div> : !page && !error && <div className="loading">loading orders /</div>}<button className="btn ghost" style={{ marginTop: 18 }} onClick={load}><RefreshCw size={14} /> Refresh</button></>;
}
