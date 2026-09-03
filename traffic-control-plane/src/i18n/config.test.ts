import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale, localeFromCookie } from './config';

test('accepts only supported locales and falls back to English', () => {
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('zh-CN'), true);
  assert.equal(isLocale('EN'), false);
  assert.equal(isLocale('zh-cn'), false);
  assert.equal(isLocale('../zh-CN'), false);
  assert.equal(isLocale(null), false);
  assert.equal(localeFromCookie('en'), 'en');
  assert.equal(localeFromCookie('zh-CN'), 'zh-CN');
  assert.equal(localeFromCookie(undefined), DEFAULT_LOCALE);
  assert.equal(localeFromCookie('EN'), DEFAULT_LOCALE);
  assert.equal(localeFromCookie('../zh-CN'), DEFAULT_LOCALE);
});

test('locale parsing does not mutate or depend on authentication cookie values', () => {
  const cookies = {
    [LOCALE_COOKIE_NAME]: 'zh-CN',
    operator_session: 'session-secret',
    operator_csrf: 'csrf-secret',
  };
  const original = { ...cookies };

  assert.equal(localeFromCookie(cookies[LOCALE_COOKIE_NAME]), 'zh-CN');
  assert.deepEqual(cookies, original);
  assert.equal(localeFromCookie(cookies.operator_session), DEFAULT_LOCALE);
  assert.equal(localeFromCookie(cookies.operator_csrf), DEFAULT_LOCALE);
});