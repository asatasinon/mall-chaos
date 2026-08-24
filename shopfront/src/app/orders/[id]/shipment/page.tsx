'use client';

import Link from 'next/link';
import { ArrowLeft, Check, PackageCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { confirmDelivery, getFulfillment } from '@/lib/api';
import type { Fulfillment } from '@/lib/types';
import { ErrorNotice, StatusPill } from '@/components/ui';

export default function ShipmentPage() {
  const { id } = useParams<{ id: string }>();
  const [shipment, setShipment] = useState<Fulfillment | null>(null);
  const [error, setError] = useState('');
  const load = () => getFulfillment(id).then(setShipment).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, [id]);
  return <><Link className="eyebrow" href={`/orders/${id}`}><ArrowLeft size={13} /> back to order</Link><div className="page-heading" style={{ marginTop: 29 }}><div><span className="eyebrow">06 / fulfillment</span><h1>Follow the handoff.</h1></div><p>The shipment timeline is written by fulfillment, then safely replayed into customer notifications.</p></div>{error && <ErrorNotice message={error} retry={load} />}{shipment && <div className="split-layout"><div className="surface"><div style={{ display: 'flex', alignItems: 'center', gap: 15 }}><div className="mini-art"><PackageCheck size={25} /></div><div><h2 style={{ margin: 0 }}>{shipment.carrier ?? 'Demo carrier'}</h2><p style={{ margin: 4, color: 'var(--muted)' }}>{shipment.trackingNo ?? 'Tracking preparing'}</p></div><StatusPill status={shipment.status} /></div><div className="timeline">{shipment.timeline?.map((item) => <div className="timeline-item" key={`${item.status}-${item.occurredAt}`}><strong>{item.status.replaceAll('_', ' ')}</strong><small>{new Date(item.occurredAt).toLocaleString()}</small><p>{item.message}</p></div>)}</div>{shipment.status === 'SHIPPED' && <button className="btn light" onClick={() => confirmDelivery(Number(id)).then(setShipment).catch((e: Error) => setError(e.message))}><Check size={15} /> Confirm delivery</button>}</div><aside className="surface"><span className="eyebrow">delivery note</span><h2 style={{ marginTop: 12 }}>Made for a clean finish.</h2><p style={{ color: 'var(--muted)' }}>Delivery confirmation is idempotent. Pressing it again will not create another timeline event.</p></aside></div>}{!shipment && !error && <div className="loading">loading shipment /</div>}</>;
}
