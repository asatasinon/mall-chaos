import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import ConsoleChrome from '@/components/ConsoleChrome';

export const metadata: Metadata = {
  title: 'Castrel · Chaos Control Plane',
  description: 'Traffic generation and chaos engineering control console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased h-screen overflow-hidden flex flex-col">
        <ThemeProvider>
          <ConsoleChrome>{children}</ConsoleChrome>
        </ThemeProvider>
      </body>
    </html>
  );
}
