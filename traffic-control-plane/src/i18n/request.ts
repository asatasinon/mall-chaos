import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import messages from './messages';
import {
  APP_TIME_ZONE,
  LOCALE_COOKIE_NAME,
  localeFromCookie,
} from './config';

const formats = {
  dateTime: {
    compact: {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: APP_TIME_ZONE,
    },
    date: {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: APP_TIME_ZONE,
    },
    time: {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
      timeZone: APP_TIME_ZONE,
    },
    calendar: {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: APP_TIME_ZONE,
    },
  },
  number: {
    integer: {
      maximumFractionDigits: 0,
    },
    decimal: {
      maximumFractionDigits: 2,
    },
    percent: {
      style: 'percent',
      maximumFractionDigits: 1,
    },
  },
} as const;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = localeFromCookie(cookieStore.get(LOCALE_COOKIE_NAME)?.value);

  return {
    locale,
    messages: messages[locale],
    formats,
    timeZone: APP_TIME_ZONE,
  };
});
