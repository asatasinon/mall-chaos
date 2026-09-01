'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';

const LINKS = [
  { href: '/',       label: 'Exercises'     },
  { href: '/runner', label: 'Runner'     },
  { href: '/operations', label: 'Operations' },
  { href: '/alerts', label: 'Alerts'     },
];

const localDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

export default function NavBar() {
  const path = usePathname();
  const router = useRouter();
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => setTime(localDateTimeFormatter.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="flex min-w-0 flex-1 items-stretch">
      {LINKS.map((l) => {
        const active = path === l.href;
        return (
          <a
            key={l.href}
            href={l.href}
            className={[
              'relative flex h-full items-center px-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
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
      <div className="ml-auto hidden items-center gap-2 pl-4 font-mono text-[11px] text-muted-foreground sm:flex">
        <span className="status-dot status-dot-green" />
        {time}
      </div>
      <button
        type="button"
        title="Sign out"
        aria-label="Sign out"
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
