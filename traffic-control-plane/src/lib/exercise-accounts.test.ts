import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExerciseAccounts } from './exercise-accounts';

test('parses JSON exercise account objects and identifies Sam', () => {
  const accounts = parseExerciseAccounts(
    '[{"label":"alice","email":"alice@example.com","password":"password-1"},{"label":"sam","email":"sam@example.com","password":"password-2","expectedCustomerId":19}]',
  );
  assert.deepEqual(accounts.map((account) => account.email), ['alice@example.com', 'sam@example.com']);
  assert.equal(accounts[1].expectedCustomerId, 19);
  assert.equal(accounts[0].expectedCustomerId, undefined);
});

test('supports multiple account objects and rejects a missing Sam identity', () => {
  assert.equal(parseExerciseAccounts('[{"label":"sam","email":"sam@example.com","password":"password-1","expectedCustomerId":19},{"label":"two","email":"two@example.com","password":"password-2"}]').length, 2);
  assert.throws(
    () => parseExerciseAccounts('[{"label":"one","email":"one@example.com","password":"password-1"}]'),
    /INVALID_TRAFFIC_EXERCISE_ACCOUNTS/,
  );
});