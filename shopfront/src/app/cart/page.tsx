'use client';

import Link from 'next/link';
import { ArrowRight, Minus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCart, getProduct, money, removeCartItem, updateCartItem } from '@/lib/api';
import type { Cart, Product } from '@/lib/types';
import { EmptyState, ErrorNotice } from '@/components/ui';

type CartRow = { item: Cart['items'][number]; product?: Product };

export default function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [rows, setRows] = useState<CartRow[]>([]);
  const [error, setError] = useState('');
  const load = () => getCart().then(async (next) => { setCart(next); setRows(await Promise.all(next.items.map(async (item) => ({ item, product: await getProduct(item.sku).catch(() => undefined) })))); }).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  const subtotal = rows.reduce((sum, row) => sum + Number(row.product?.price ?? 0) * row.item.quantity, 0);
  if (!cart && !error) return <div className="loading">opening basket /</div>;
  return <><div className="page-heading"><div><span className="eyebrow">02 / basket</span><h1>Your basket.</h1></div><p>Cart version <span className="price">{cart?.version ?? '—'}</span>. A versioned basket protects checkout from silent changes.</p></div>{error && <ErrorNotice message={error} retry={load} />}{cart && cart.items.length === 0 && <EmptyState title="Nothing here yet" body="The good stuff is waiting in the catalog." href="/products" action="Find something" />}{cart && cart.items.length > 0 && <div className="split-layout"><div className="surface">{rows.map(({ item, product }) => <div className="list-row" key={item.id}><div className="mini-art">{product?.name.slice(0, 1) ?? '?'}</div><div className="row-grow"><strong>{product?.name ?? item.sku}</strong><small>{item.sku} · {product ? money(product.price) : 'price pending'}</small></div><div className="quantity"><button aria-label="Decrease quantity" disabled={item.quantity <= 1} onClick={() => updateCartItem(item.id, item.sku, item.quantity - 1).then(() => load()).catch((e: Error) => setError(e.message))}><Minus size={14} /></button><span>{item.quantity}</span><button aria-label="Increase quantity" onClick={() => updateCartItem(item.id, item.sku, item.quantity + 1).then(() => load()).catch((e: Error) => setError(e.message))}><Plus size={14} /></button></div><button className="icon-btn" aria-label={`Delete ${product?.name ?? item.sku}`} onClick={() => removeCartItem(item.id).then(() => load()).catch((e: Error) => setError(e.message))}><Trash2 size={15} /></button></div>)}</div><aside className="surface summary"><h2>Order preview</h2><div className="summary-line"><span>{cart.items.length} objects</span><span>{cart.items.reduce((sum, item) => sum + item.quantity, 0)} units</span></div><div className="summary-line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div className="summary-line total"><span>Estimated total</span><strong>{money(subtotal)}</strong></div><Link className="btn full" href="/checkout" style={{ marginTop: 20 }}>Continue to checkout <ArrowRight size={15} /></Link></aside></div>}</>;
}
