import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLifecycleAccounts,
  summariseLifecycleAccounts,
  validateLoginIdentity,
} from '../lib/lifecycle-accounts';

const validJson = JSON.stringify([
  {
    label: 'alice',
    email: 'alice@example.com',
    password: 'development-password',
    expectedCustomerId: 1,
    enabled: true,
  },
  {
    label: 'bob',
    email: 'bob@example.com',
    password: 'development-password',
    expectedCustomerId: 2,
    enabled: false,
  },
]);

test('lifecycle accounts fail closed when enabled and malformed', () => {
  assert.throws(() => parseLifecycleAccounts('{', true), /INVALID_LIFECYCLE_ACCOUNTS/);
  assert.throws(() => parseLifecycleAccounts('[]', true), /NO_ENABLED_LIFECYCLE_ACCOUNT/);
  assert.throws(
    () => parseLifecycleAccounts(JSON.stringify([
      { label: 'same', email: 'a@example.com', password: 'password-123', enabled: true },
      { label: 'same', email: 'b@example.com', password: 'password-123', enabled: true },
    ]), true),
    /DUPLICATE_LIFECYCLE_ACCOUNT/,
  );
});

test('lifecycle account summaries never contain credentials', () => {
  const accounts = parseLifecycleAccounts(validJson, true);
  const summary = summariseLifecycleAccounts(accounts);
  assert.deepEqual(summary, [
    { label: 'alice', enabled: true, expectedCustomerId: 1 },
    { label: 'bob', enabled: false, expectedCustomerId: 2 },
  ]);
  assert.equal(JSON.stringify(summary).includes('development-password'), false);
  assert.equal(JSON.stringify(summary).includes('@example.com'), false);
});

test('login identity must match the configured customer id', () => {
  const account = parseLifecycleAccounts(validJson, true)[0];
  assert.equal(validateLoginIdentity(account, { userId: 1 }), 1);
  assert.throws(
    () => validateLoginIdentity(account, { userId: 2 }),
    /LIFECYCLE_CUSTOMER_ID_MISMATCH/,
  );
  assert.throws(
    () => validateLoginIdentity({ ...account, enabled: false }, { userId: 1 }),
    /LIFECYCLE_LOGIN_IDENTITY_INVALID/,
  );
});