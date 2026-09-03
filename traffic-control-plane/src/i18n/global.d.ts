import type enMessages from './messages/en';
import type { Locale } from './config';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof enMessages;
  }
}
