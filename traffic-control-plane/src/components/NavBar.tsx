'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/',          label: 'Overview'   },
  { href: '/runner',    label: 'Runner'     },
  { href: '/chaos',     label: 'Chaos Ctl'  },
  { href: '/scenarios', label: 'Scenarios'  },
];

export default function NavBar() {
  const path = usePathname();
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="flex items-stretch flex-1">
      {LINKS.map((l) => {
        const active = path === l.href;
        return (
          <a
            key={l.href}
            href={l.href}
            className={[
              'relative flex items-center px-4 h-full text-sm font-medium transition-colors',
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
      <div className="ml-auto flex items-center gap-2 pl-4 text-[11px] text-muted-foreground font-mono">
        <span className="status-dot status-dot-green" />
        {time}
      </div>
    </nav>
  );
}
