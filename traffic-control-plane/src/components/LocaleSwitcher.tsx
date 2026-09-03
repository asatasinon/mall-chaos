'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition, type ChangeEvent } from 'react';
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  isLocale,
} from '@/i18n/config';

const LOCALE_OPTIONS = [
  { value: 'en', labelKey: 'english' },
  { value: 'zh-CN', labelKey: 'simplifiedChinese' },
] as const;

export default function LocaleSwitcher({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations('Navigation');

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.currentTarget.value;
    if (!isLocale(nextLocale) || nextLocale === locale) return;

    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(nextLocale)}; Max-Age=${LOCALE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    document.documentElement.lang = nextLocale;
    startTransition(() => router.refresh());
  };

  return (
    <label className={`inline-flex min-w-0 ${className}`}>
      <span className="sr-only">{t('languageLabel')}</span>
      <select
        value={locale}
        onChange={handleChange}
        aria-label={t('languageLabel')}
        title={t('languageLabel')}
        disabled={isPending}
        className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}
