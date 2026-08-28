import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, formatWarmupDate, parseWarmupDates } from './data-warmup';

test('adds calendar days without shifting Shanghai dates', () => {
  assert.equal(addDays('2026-08-28', 0), '2026-08-28');
  assert.equal(addDays('2026-08-28', 1), '2026-08-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('loads warmup dates from mysql JSON arrays and strings', () => {
  assert.deepEqual(parseWarmupDates(['2026-08-28']), ['2026-08-28']);
  assert.deepEqual(parseWarmupDates('["2026-08-28"]'), ['2026-08-28']);
});

test('formats mysql date values without shifting the application date', () => {
  assert.equal(formatWarmupDate(new Date('2026-03-06T16:00:00.000Z')), '2026-03-07');
  assert.equal(formatWarmupDate('2026-03-07'), '2026-03-07');
});