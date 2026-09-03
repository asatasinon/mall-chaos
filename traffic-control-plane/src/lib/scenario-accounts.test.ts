import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScenarioAccounts } from './scenario-accounts';

test('parses JSON scenario account objects and identifies Sam', () => {
  const accounts = parseScenarioAccounts(
    '[{"label":"alice","email":"alice@example.com","password":"password-1"},{"label":"sam","email":"sam@example.com","password":"password-2","expectedCustomerId":19}]',
  );
  assert.deepEqual(accounts.map((account) => account.email), ['alice@example.com', 'sam@example.com']);
  assert.equal(accounts[1].expectedCustomerId, 19);
  assert.equal(accounts[0].expectedCustomerId, undefined);
});

test('supports multiple account objects and rejects a missing Sam identity', () => {
  assert.equal(parseScenarioAccounts('[{"label":"sam","email":"sam@example.com","password":"password-1","expectedCustomerId":19},{"label":"two","email":"two@example.com","password":"password-2"}]').length, 2);
  assert.throws(
    () => parseScenarioAccounts('[{"label":"one","email":"one@example.com","password":"password-1"}]'),
    /INVALID_TRAFFIC_SCENARIO_ACCOUNTS/,
  );
});