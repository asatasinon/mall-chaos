'use client';

import { useTranslations } from 'next-intl';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { isClientNetworkError } from '@/lib/client-error';

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('Login');
  const commonT = useTranslations('Common');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/operator/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      router.replace(safeReturnTo(returnTo));
    } catch (cause) {
      setError(isClientNetworkError(cause) ? commonT('networkError') : cause instanceof Error ? cause.message : t('loginFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex min-h-full items-center justify-center">
      <div className="w-full max-w-sm space-y-3">
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 flex justify-end">
            <LocaleSwitcher />
          </div>
          <div className="mb-6 flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary"><LockKeyhole className="size-5" /></div>
            <div>
              <h1 className="text-lg font-semibold">{t('title')}</h1>
              <p className="mt-1 text-xs text-muted-foreground">{t('description')}</p>
            </div>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('username')}</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('password')}</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}
            <Button className="w-full" type="submit" disabled={submitting || !username || !password}>{submitting ? t('signingIn') : <>{t('signIn')} <ArrowRight aria-hidden="true" /></>}</Button>
          </form>
        </div>
      </div>
    </section>
  );
}
