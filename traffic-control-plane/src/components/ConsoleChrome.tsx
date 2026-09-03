'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import NavBar from '@/components/NavBar';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function ConsoleChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('Navigation');
  const isLogin = pathname === '/login';

  if (isLogin) return <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>;

  return (
    <>
      <header className="sticky top-0 z-40 flex h-13 shrink-0 items-stretch overflow-hidden border-b border-border bg-card/50 px-3 backdrop-blur-sm sm:px-6">
        <div className="mr-0 flex shrink-0 items-center border-r border-border pr-3 sm:mr-1 sm:pr-6">
          <span className="text-base font-bold tracking-tight text-foreground sm:text-lg">Castrel</span>
          <span className="ml-1.5 text-base font-semibold text-primary sm:ml-2 sm:text-lg">Chaos</span>
        </div>
        <NavBar />
        <div className="ml-2 flex shrink-0 items-center gap-2 border-l border-border pl-2 sm:ml-3 sm:pl-3">
          <LocaleSwitcher className="w-[5.75rem] sm:w-36" />
          <ThemeToggle />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      <footer className="border-t border-border px-6 py-2.5 flex justify-between text-[11px] text-muted-foreground tracking-wide">
        <span>Castrel Chaos · v2.0</span>
        <span>{t('protectedControl')}</span>
      </footer>
    </>
  );
}
