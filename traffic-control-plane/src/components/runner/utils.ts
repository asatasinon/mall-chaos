import { APP_TIME_ZONE } from '@/i18n/config';

export function formatTimestamp(value: string | null | undefined, locale = 'en', fallback = '—'): string {
  return value ? new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: APP_TIME_ZONE,
  }).format(new Date(value)) : fallback;
}

export function formatNumber(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatBytes(value: number, locale = 'en', fallback = 'size pending'): string {
  if (!value) return fallback;
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale).format(Math.round(value / 1024))} KB`;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

export function todayInShanghaiClient(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
