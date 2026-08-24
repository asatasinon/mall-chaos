'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getProducts } from '@/lib/api';
import type { Page, Product } from '@/lib/types';
import { ErrorNotice, ProductCard } from '@/components/ui';

export default function ProductsPage() {
  const [page, setPage] = useState<Page<Product> | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('latest');
  const [pageNumber, setPageNumber] = useState(0);
  const [error, setError] = useState('');

  const load = (nextPage = pageNumber) => {
    setError('');
    const query = new URLSearchParams({ size: '12', page: String(nextPage), sort });
    if (keyword) query.set('keyword', keyword);
    if (category) query.set('category', category);
    getProducts(`?${query}`).then(setPage).catch((e: Error) => setError(e.message));
  };
  useEffect(() => { load(0); }, [sort]);

  return <><div className="page-heading"><div><span className="eyebrow">01 / catalog</span><h1>The current edit.</h1></div><p>Browse the available collection. Search and sorting stay deliberately simple, so the useful thing remains easy to find.</p></div>
    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setPageNumber(0); load(0); }}><Search size={17} color="var(--muted)" /><input className="input search-input" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Search by name or keyword" aria-label="搜索商品" /><select className="select" value={category} onChange={(event) => { setCategory(event.target.value); setPageNumber(0); }} aria-label="商品分类"><option value="">All categories</option><option value="home">Home</option><option value="desk">Desk</option><option value="daily">Daily</option></select><select className="select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序"><option value="latest">Latest</option><option value="price_asc">Price / low</option><option value="price_desc">Price / high</option></select><button className="btn" type="submit">Filter</button></form>
    {error && <ErrorNotice message={error} retry={() => load()} />}
    {page?.content.length ? <><div className="product-grid">{page.content.map((product, index) => <ProductCard product={product} index={index} key={product.sku} />)}</div><div className="pagination"><button className="btn ghost" disabled={pageNumber === 0} onClick={() => { const next = pageNumber - 1; setPageNumber(next); load(next); }}>Previous</button><span className="eyebrow">page {pageNumber + 1} / {Math.max(page.totalPages, 1)}</span><button className="btn ghost" disabled={pageNumber + 1 >= page.totalPages} onClick={() => { const next = pageNumber + 1; setPageNumber(next); load(next); }}>Next</button></div></> : page && <div className="empty"><h2>No objects found</h2><p>Try a wider search or another collection.</p></div>}
    {!page && !error && <div className="loading">loading catalog /</div>}
  </>;
}
