'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      closeButton
      duration={4_000}
      offset={{ top: 68, right: 24 }}
      position="top-right"
      richColors
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      toastOptions={{
        classNames: {
          toast: 'border shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-xs opacity-90',
          closeButton: 'border-current/20 bg-transparent text-current hover:bg-black/10 hover:text-current dark:hover:bg-white/10',
        },
      }}
    />
  );
}