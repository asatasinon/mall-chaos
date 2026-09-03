import assert from 'node:assert/strict';
import test from 'node:test';
import { isClientNetworkError } from './client-error';

test('recognizes browser transport failures without classifying backend errors as network errors', () => {
  assert.equal(isClientNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(isClientNetworkError(new TypeError('Load failed')), true);
  assert.equal(isClientNetworkError(new TypeError('NetworkError when attempting to fetch resource')), true);
  assert.equal(isClientNetworkError(new Error('BACKEND_VALIDATION_FAILED')), false);
  assert.equal(isClientNetworkError(new SyntaxError('Unexpected token')), false);
});