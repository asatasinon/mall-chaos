import Link from 'next/link';
import Image from 'next/image';
import { AlertCircle, ArrowRight, PackageOpen } from 'lucide-react';
import type { Product } from '@/lib/types';
import { money } from '@/lib/api';

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="alert"><AlertCircle size={17} /><div><strong>这一步暂时没有完成</strong>{message}{retry && <button className="btn ghost" onClick={retry} style={{ marginTop: 10 }}>再试一次</button>}</div></div>;
}

export function EmptyState({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return <div className="empty"><PackageOpen size={25} /><h2>{title}</h2><p>{body}</p>{href && <Link className="btn" href={href}>{action ?? '继续浏览'} <ArrowRight size={14} /></Link>}</div>;
}

export function StatusPill({ status }: { status: string }) {
  const tone = status.includes('FAILED') || status.includes('CANCEL') ? 'failed' : status.includes('PENDING') || status === 'UNKNOWN' ? 'pending' : '';
  return <span className={`status ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const available = product.status === 1 && (product.availableQty ?? 0) > 0;
  return <article className="product-card" style={{ animationDelay: `${index * 70}ms` }}>
    <Link href={`/products/${encodeURIComponent(product.sku)}`} className="product-visual">
      <span className="availability">{available ? `${product.availableQty ?? 0} available` : 'not available'}</span>
      {product.mediaUrl ? <Image src={product.mediaUrl} alt={product.name} width={640} height={672} unoptimized /> : <span className="product-placeholder">{product.name.slice(0, 1)}</span>}
    </Link>
    <div className="product-info"><h3><Link href={`/products/${encodeURIComponent(product.sku)}`}>{product.name}</Link></h3><div className="product-meta"><span>{product.category ?? 'collection'}</span><span className="price">{money(product.price)}</span></div></div>
  </article>;
}
