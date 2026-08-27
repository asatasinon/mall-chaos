'use client';

import { usePathname } from 'next/navigation';
import NavBar from '@/components/NavBar';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function ConsoleChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === '/login';

  if (isLogin) return <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>;

  return (
    <>
      <header className="h-13 border-b border-border bg-card/50 backdrop-blur-sm flex items-stretch px-6 shrink-0 sticky top-0 z-40">
        <div className="flex items-center pr-6 border-r border-border mr-1 shrink-0">
          <span className="text-lg font-bold tracking-tight text-foreground">Castrel</span>
          <span className="mx-2 text-border font-light">/</span>
          <span className="text-lg font-semibold text-primary">Operations</span>
        </div>
        <NavBar />
        <div className="flex items-center pl-3 border-l border-border ml-3">
          <ThemeToggle />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      <footer className="border-t border-border px-6 py-2.5 flex justify-between text-[11px] text-muted-foreground tracking-wide">
        <span>Traffic Control Plane · v2.0</span>
        <span>Protected Fault Run control</span>
      </footer>
    </>
  );
}
