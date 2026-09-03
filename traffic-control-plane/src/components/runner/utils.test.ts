import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBytes,
  formatNavigationDateTime,
  formatNumber,
  formatTimestamp,
  todayInShanghaiClient,
} from './utils';

test('formats navigation dates as yyyy-MM-dd HH:mm:ss in Shanghai time', () => {
  assert.equal(
    formatNavigationDateTime(new Date('2026-09-02T16:30:00.000Z')),
    '2026-09-03 00:30:00',
  );
  assert.match(
    formatNavigationDateTime(new Date('2026-01-02T03:04:05.000Z')),
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  );
});

test('formats dates with locale and Shanghai timezone semantics', () => {
  const value = '2026-09-02T16:30:00.000Z';
  const previousShanghaiDay = '2026-09-02T15:30:00.000Z';
  const english = formatTimestamp(value, 'en-US');
  const chinese = formatTimestamp(value, 'zh-CN');

  assert.notEqual(english, formatTimestamp(previousShanghaiDay, 'en-US'));
  assert.notEqual(chinese, formatTimestamp(previousShanghaiDay, 'zh-CN'));
  assert.notEqual(english, chinese);
  assert.equal(formatTimestamp(null, 'zh-CN', '暂无'), '暂无');
});

test('formats numbers and byte values without changing the underlying values', () => {
  assert.equal(formatNumber(1234567, 'en-US'), '1,234,567');
  assert.equal(formatNumber(1234567, 'zh-CN'), '1,234,567');
  assert.equal(formatBytes(1024, 'zh-CN'), '1 KB');
  assert.equal(formatBytes(1024 * 1024, 'zh-CN'), '1.0 MB');
  assert.equal(formatBytes(0, 'zh-CN', '大小待确认'), '大小待确认');
});

test('returns an ISO date for the Shanghai business calendar', () => {
  assert.match(todayInShanghaiClient(), /^\d{4}-\d{2}-\d{2}$/);
});