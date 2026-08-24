'use client';

import { Bell, CheckCheck, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getNotifications, markNotificationRead } from '@/lib/api';
import type { Notification, Page } from '@/lib/types';
import { ErrorNotice, EmptyState } from '@/components/ui';

export default function NotificationsPage() {
  const [page, setPage] = useState<Page<Notification> | null>(null);
  const [error, setError] = useState('');
  const load = () => getNotifications().then(setPage).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  const read = (id: number) => markNotificationRead(id).then((item) => setPage((current) => current ? { ...current, content: current.content.map((notification) => notification.id === item.id ? item : notification) } : current)).catch((e: Error) => setError(e.message));
  return <><div className="page-heading"><div><span className="eyebrow">07 / inbox</span><h1>Signals from the journey.</h1></div><p>Payment, risk and fulfillment events arrive here without exposing internal service details.</p></div>{error && <ErrorNotice message={error} retry={load} />}{page?.content.length === 0 && <EmptyState title="All quiet" body="Your order updates will appear here." />}{page?.content.length ? <div className="surface">{page.content.map((notification) => <div className="list-row" key={notification.id} style={{ opacity: notification.read ? .58 : 1 }}><div className="mini-art"><Bell size={19} /></div><div className="row-grow"><strong>{notification.title}</strong><small>{notification.body}</small><small style={{ display: 'block', marginTop: 4 }}>{new Date(notification.createdAt).toLocaleString()} · {notification.eventType}</small></div>{notification.read ? <CheckCheck size={16} color="var(--muted)" /> : <button className="btn ghost" onClick={() => read(notification.id)}><Mail size={14} /> Mark read</button>}</div>)}</div> : !page && !error && <div className="loading">opening inbox /</div>}</>;
}
