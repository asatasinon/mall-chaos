import type { Metadata } from 'next';
import './globals.css';
import { ShopShell } from '@/components/shop-shell';

export const metadata: Metadata = {
  title: 'Castrel Shopfront',
  description: 'A resilient demonstration storefront for Castrel Chaos',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ShopShell>{children}</ShopShell>
      </body>
    </html>
  );
}
