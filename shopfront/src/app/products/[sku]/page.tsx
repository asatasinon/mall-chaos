'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { addCartItem, getProduct, money } from '@/lib/api';
import type { Product } from '@/lib/types';
import { ErrorNotice } from '@/components/ui';

export default function ProductDetailPage() {
  const params = useParams<{ sku: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { getProduct(params.sku).then(setProduct).catch((e: Error) => setError(e.message)); }, [params.sku]);
  if (error) return <ErrorNotice message={error} />;
  if (!product) return <div className="loading">loading object /</div>;
  const available = product.status === 1 && (product.availableQty ?? 0) > 0;
  return <><Link className="eyebrow" href="/products"><ArrowLeft size={13} /> back to catalog</Link><div className="detail-layout" style={{ marginTop: 30 }}><div className="detail-visual">{product.mediaUrl ? <Image src={product.mediaUrl} alt={product.name} width={800} height={800} unoptimized style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="product-placeholder">{product.name.slice(0, 1)}</span>}</div><div className="detail-copy"><span className="eyebrow">{product.category ?? 'collection'} / {product.sku}</span><h1>{product.name}</h1><p>A considered object from the current Castrel collection. Availability is checked again when the basket is settled.</p><span className="price">{money(product.price)}</span><div className="detail-rule" /><span className="detail-label">quantity / {product.availableQty ?? 0} available</span><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><div className="quantity"><button aria-label="减少数量" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><span>{quantity}</span><button aria-label="增加数量" onClick={() => setQuantity(Math.min(product.availableQty ?? 99, quantity + 1))}>+</button></div><button className="btn" disabled={!available} onClick={() => addCartItem(product.sku, quantity).then(() => { setMessage('Added to your basket.'); window.dispatchEvent(new Event('cart-updated')); }).catch((e: Error) => setError(e.message))}><Plus size={15} />{available ? 'Add to basket' : 'Unavailable'}</button></div>{message && <p style={{ color: 'var(--acid-deep)', fontWeight: 700 }}><Check size={15} /> {message}</p>}{error && <ErrorNotice message={error} />}</div></div></>;
}
