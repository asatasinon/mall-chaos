'use client';

import Link from 'next/link';
import { ArrowUpRight, ScanLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getProducts } from '@/lib/api';
import type { Product } from '@/lib/types';
import { ErrorNotice, ProductCard } from '@/components/ui';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { getProducts('?size=4&sort=latest').then((page) => setProducts(page.content)).catch((e: Error) => setError(e.message)); }, []);

  return <>
    <section className="hero reveal">
      <div className="hero-copy"><span className="eyebrow" style={{ color: 'var(--acid)' }}>Castrel / everyday objects</span><h1>Things with a pulse.</h1><p>A small, living catalog for the Castrel commerce lab. Browse the current edit, build a basket, and watch every handoff stay visible.</p><div className="hero-actions"><Link className="btn light" href="/products">Explore the edit <ArrowUpRight size={15} /></Link><Link className="btn secondary" href="/cart">Open your basket</Link></div></div>
      <div className="hero-art"><div className="orbit-card"><div className="orb" /><strong>Object / 04</strong><small>available in the current collection</small></div></div>
    </section>
    <div className="stat-band reveal-delay"><div><strong>01</strong><span>one calm checkout</span></div><div><strong>∞</strong><span>recovery-minded by design</span></div><div><strong><ScanLine size={25} strokeWidth={1.5} /></strong><span>every handoff traceable</span></div></div>
    <section className="section"><div className="section-head"><h2>Fresh from the catalog</h2><Link href="/products">View all products <ArrowUpRight size={13} /></Link></div>{error && <ErrorNotice message={error} />}{products.length > 0 ? <div className="product-grid">{products.map((product, index) => <ProductCard product={product} index={index} key={product.sku} />)}</div> : !error && <div className="loading">loading catalog /</div>}</section>
  </>;
}
