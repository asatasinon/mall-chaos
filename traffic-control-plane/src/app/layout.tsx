import type { Metadata } from 'next';
import './globals.css';
import NavBar from '@/components/NavBar';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Castrel · Chaos Control Plane',
  description: 'Traffic generation and chaos engineering control console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased min-h-screen flex flex-col">
        <ThemeProvider>
          <header className="h-13 border-b border-border bg-card/50 backdrop-blur-sm flex items-stretch px-6 shrink-0 sticky top-0 z-40">
            <div className="flex items-center pr-6 border-r border-border mr-1 shrink-0">
              <span className="text-lg font-bold tracking-tight text-foreground">Castrel</span>
              <span className="mx-2 text-border font-light">/</span>
              <span className="text-lg font-semibold text-primary">Chaos</span>
            </div>
            <NavBar />
            <div className="flex items-center pl-3 border-l border-border ml-3">
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">{children}</main>
          <footer className="border-t border-border px-6 py-2.5 flex justify-between text-[11px] text-muted-foreground tracking-wide">
            <span>Traffic Control Plane · v2.0</span>
            <span>All chaos endpoints active</span>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
