'use client';

import { MapPin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, getAddresses } from '@/lib/api';
import type { Address } from '@/lib/types';
import { ErrorNotice, EmptyState } from '@/components/ui';

const emptyForm = { province: '', city: '', district: '', detail: '', receiver: '', phone: '', isDefault: false };

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const load = () => getAddresses().then(setAddresses).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); try { await api<Address[]>('me/addresses', { method: 'POST', body: JSON.stringify(form) }); setForm(emptyForm); setOpen(false); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Address could not be saved'); } };
  const remove = async (id: number) => { try { await api<Address[]>(`me/addresses/${id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Address could not be deleted'); } };
  return <><div className="page-heading"><div><span className="eyebrow">account / addresses</span><h1>Places to land.</h1></div><button className="btn light" onClick={() => setOpen(!open)}><Plus size={15} /> {open ? 'Close' : 'New address'}</button></div>{error && <ErrorNotice message={error} retry={load} />}{open && <form className="surface" onSubmit={submit} style={{ marginBottom: 16 }}><div className="form-grid">{Object.entries(form).filter(([key]) => key !== 'isDefault').map(([key, value]) => <div className="field" key={key}><label htmlFor={key}>{key}</label><input className="input" id={key} required={key !== 'district'} value={String(value)} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></div>)}<label className="field full-field"><span className="detail-label" style={{ margin: 0 }}><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} /> Make default</span></label></div><button className="btn" type="submit">Save address</button></form>}{addresses.length ? <div className="surface">{addresses.map((address) => <div className="list-row" key={address.id}><MapPin size={18} color="var(--coral)" /><div className="row-grow"><strong>{address.receiver} {address.isDefault && <span className="eyebrow">default</span>}</strong><small>{address.phone} · {address.province} {address.city} {address.district} {address.detail}</small></div><button className="icon-btn" aria-label={`Delete ${address.receiver}'s address`} onClick={() => remove(address.id)}><Trash2 size={15} /></button></div>)}</div> : !error && <EmptyState title="No saved places" body="Add an address so checkout knows where the handoff ends." />}</>;
}
