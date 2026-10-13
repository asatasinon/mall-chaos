import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEvidenceNoteText } from './evidence-note-policy';

test('note policy preserves plain text and only normalizes line endings', () => {
  assert.deepEqual(validateEvidenceNoteText('Recovery looked stable\r\nfor the next check.'), {
    valid: true,
    text: 'Recovery looked stable\nfor the next check.',
  });
});

test('note policy rejects empty, oversized and unsupported control-character input', () => {
  for (const text of [
    '',
    ' \n\t ',
    'x'.repeat(2049),
    'é'.repeat(1025),
    'contains\u0000control',
  ]) {
    const result = validateEvidenceNoteText(text);
    assert.deepEqual(result, { valid: false, reasonCode: 'INVALID_EVIDENCE_NOTE' });
    if (text.length > 0) assert.equal(JSON.stringify(result).includes(text), false);
  }
});

test('note policy rejects HTML markup without returning submitted content', () => {
  for (const text of ['<script>alert(1)</script>', '<!-- private -->']) {
    const result = validateEvidenceNoteText(text);
    assert.deepEqual(result, { valid: false, reasonCode: 'EVIDENCE_NOTE_HTML_NOT_ALLOWED' });
    assert.equal(JSON.stringify(result).includes(text), false);
  }
});

test('note policy rejects explicit credential forms without claiming general secret detection', () => {
  for (const text of [
    'Authorization: Bearer abcdefghijklmnop',
    'cookie=sessionid=secret-value',
    'https://user:password@example.test/path',
    'eyJabcdefghijk.eyJabcdefghijk.eyJabcdefghijk',
  ]) {
    const result = validateEvidenceNoteText(text);
    assert.deepEqual(result, { valid: false, reasonCode: 'EVIDENCE_NOTE_CREDENTIAL_NOT_ALLOWED' });
    assert.equal(JSON.stringify(result).includes(text), false);
  }
});

test('note policy rejects JSON and newline-delimited structured exports', () => {
  for (const text of [
    '{"traceId":"abc","message":"line"}',
    '{"service":"catalog"}\n{"service":"order"}',
    '[{"orderId":"private"}]',
  ]) {
    const result = validateEvidenceNoteText(text);
    assert.deepEqual(result, { valid: false, reasonCode: 'EVIDENCE_NOTE_EXPORT_NOT_ALLOWED' });
    assert.equal(JSON.stringify(result).includes(text), false);
  }
});
