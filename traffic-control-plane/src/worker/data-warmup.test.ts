import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from './data-warmup';

test('adds calendar days without shifting Shanghai dates', () => {
  assert.equal(addDays('2026-08-28', 0), '2026-08-28');
  assert.equal(addDays('2026-08-28', 1), '2026-08-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});