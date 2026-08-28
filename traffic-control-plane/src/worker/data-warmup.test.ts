import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, parseWarmupDates } from './data-warmup';

test('adds calendar days without shifting Shanghai dates', () => {
  assert.equal(addDays('2026-08-28', 0), '2026-08-28');
  assert.equal(addDays('2026-08-28', 1), '2026-08-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('loads warmup dates from mysql JSON arrays and strings', () => {
  assert.deepEqual(parseWarmupDates(['2026-08-28']), ['2026-08-28']);
  assert.deepEqual(parseWarmupDates('["2026-08-28"]'), ['2026-08-28']);
});