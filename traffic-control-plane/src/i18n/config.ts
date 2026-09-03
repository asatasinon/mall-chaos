export const LOCALES = ['en', 'zh-CN'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE_NAME = 'control_plane_locale';
export const APP_TIME_ZONE = 'Asia/Shanghai';
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale);
}

export function localeFromCookie(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
