'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  isLocale,
  type Locale,
} from '@/i18n/config';

const LOCALE_LABELS = {
  en: 'EN',
  'zh-CN': '中',
} as const;

function persistLocale(locale: Locale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Max-Age=${LOCALE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  document.documentElement.lang = locale;
}

export default function LocaleSwitcher({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations('Navigation');

  const handleChange = (nextLocale: string) => {
    if (!isLocale(nextLocale) || nextLocale === locale) return;

    persistLocale(nextLocale);
    startTransition(() => router.refresh());
  };

  return (
    <button
      type="button"
      onClick={() => handleChange(locale === 'en' ? 'zh-CN' : 'en')}
      disabled={isPending}
      aria-label={t('languageLabel')}
      title={t('languageLabel')}
      className={`inline-flex h-8 w-14 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      <Languages aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span>{LOCALE_LABELS[locale]}</span>
    </button>
  );
}
