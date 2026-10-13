const MAX_NOTE_TEXT_BYTES = 2048;
const HTML_MARKUP_PATTERN = /<!--|<!doctype\b|<\/?[a-z][^>]*>/iu;
const CREDENTIAL_PATTERN = /\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+/iu;
const BEARER_TOKEN_PATTERN = /\bbearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/iu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u;
const URL_CREDENTIAL_PATTERN = /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/iu;

export type EvidenceNoteRejectionCode =
  | 'INVALID_EVIDENCE_NOTE'
  | 'EVIDENCE_NOTE_HTML_NOT_ALLOWED'
  | 'EVIDENCE_NOTE_CREDENTIAL_NOT_ALLOWED'
  | 'EVIDENCE_NOTE_EXPORT_NOT_ALLOWED';

export type EvidenceNoteTextValidation =
  | { readonly valid: true; readonly text: string }
  | { readonly valid: false; readonly reasonCode: EvidenceNoteRejectionCode };

export function validateEvidenceNoteText(input: string): EvidenceNoteTextValidation {
  const text = input.replace(/\r\n?/gu, '\n');
  if (text.trim().length === 0
    || Buffer.byteLength(text, 'utf8') > MAX_NOTE_TEXT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    return { valid: false, reasonCode: 'INVALID_EVIDENCE_NOTE' };
  }
  if (HTML_MARKUP_PATTERN.test(text)) {
    return { valid: false, reasonCode: 'EVIDENCE_NOTE_HTML_NOT_ALLOWED' };
  }
  if (CREDENTIAL_PATTERN.test(text)
    || BEARER_TOKEN_PATTERN.test(text)
    || JWT_PATTERN.test(text)
    || URL_CREDENTIAL_PATTERN.test(text)) {
    return { valid: false, reasonCode: 'EVIDENCE_NOTE_CREDENTIAL_NOT_ALLOWED' };
  }
  if (isStructuredExport(text)) {
    return { valid: false, reasonCode: 'EVIDENCE_NOTE_EXPORT_NOT_ALLOWED' };
  }
  return { valid: true, text };
}

function isStructuredExport(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (isJsonRecordOrArray(trimmed)) return true;
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 && lines.every(isJsonRecordOrArray);
}

function isJsonRecordOrArray(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object';
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
