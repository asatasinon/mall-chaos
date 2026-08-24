'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, ShoppingBag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCart, cartQuantity, getSession, logout } from '@/lib/api';
import type { AuthSession } from '@/lib/auth';
import type { Cart } from '@/lib/types';

export function ShopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [cart, setCart] = useState<Cart | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    getCart().then(setCart).catch(() => setCart(null));
    const refresh = () => getCart().then(setCart).catch(() => setCart(null));
    window.addEventListener('cart-updated', refresh);
    return () => window.removeEventListener('cart-updated', refresh);
  }, [pathname]);

  useEffect(() => {
    const loadSession = () => getSession().then(setSession);
    loadSession();
    window.addEventListener('auth-updated', loadSession);
    return () => window.removeEventListener('auth-updated', loadSession);
  }, [pathname]);

  const signOut = async () => {
    await logout().catch(() => undefined);
    setSession(null);
    window.dispatchEvent(new Event('auth-updated'));
  };

  const nav = [
    { href: '/', label: '首页' },
    { href: '/products', label: '商品' },
    { href: '/orders', label: '订单' },
    { href: '/notifications', label: '通知' },
  ];

  return (
    <div className="site-frame">
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Castrel Shopfront 首页">
            <span className="brand-mark">C</span>
            <span>Castrel / shopfront</span>
          </Link>
          <nav className="header-nav" aria-label="主导航">
            {nav.map((item) => (
              <Link className={pathname === item.href ? 'active' : ''} href={item.href} key={item.href}>{item.label}</Link>
            ))}
          </nav>
          <div className="header-actions">
            <span className="demo-chip"><i /> demo channel</span>
            <Link className="account-link" href="/auth"><UserRound size={15} />{session ? `#${session.userId}` : '登录'}</Link>
            {session && <button className="icon-btn header-logout" aria-label="登出" onClick={signOut}><LogOut size={15} /></button>}
            <Link className="cart-link" href="/cart"><ShoppingBag size={15} strokeWidth={1.8} />购物车 <span className="cart-count">{cartQuantity(cart)}</span></Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer"><span>Castrel Shopfront · resilient commerce lab</span><span>browser → BFF → gateway</span></footer>
    </div>
  );
}
