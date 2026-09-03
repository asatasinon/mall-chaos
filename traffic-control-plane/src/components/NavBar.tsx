'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { formatNavigationDateTime } from './runner/utils';

export default function NavBar() {
  const path = usePathname();
  const router = useRouter();
  const t = useTranslations('Navigation');
  const [time, setTime] = useState('');
  const links = [
    { href: '/', label: t('scenarios') },
    { href: '/runbook', label: t('runbook') },
    { href: '/runner', label: t('runner') },
    { href: '/operations', label: t('operations') },
    { href: '/alerts', label: t('alerts') },
  ];

  useEffect(() => {
    const tick = () => setTime(formatNavigationDateTime(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="console-nav flex min-w-0 flex-1 items-stretch overflow-x-auto overscroll-x-contain">
      {links.map((l) => {
        const active = path === l.href;
        return (
          <a
            key={l.href}
            href={l.href}
            className={[
              'relative flex h-full shrink-0 items-center px-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {l.label}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </a>
        );
      })}
      <div className="ml-auto hidden items-center gap-2 pl-4 font-mono text-[11px] text-muted-foreground sm:flex" title={t('currentTime')}>
        <span className="status-dot status-dot-green" />
        <span className="sr-only">{t('live')}</span>
        {time}
      </div>
      <button
        type="button"
        title={t('signOut')}
        aria-label={t('signOut')}
        className="ml-2 flex shrink-0 items-center px-1 text-muted-foreground transition-colors hover:text-foreground sm:ml-4 sm:px-2"
        onClick={async () => {
          await fetch('/api/operator/session', { method: 'DELETE' });
          router.replace('/login');
        }}
      >
        <LogOut className="size-4" />
      </button>
    </nav>
  );
}
