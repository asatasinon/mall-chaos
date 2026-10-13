export type BoundedJsonResponseErrorCode = 'RESPONSE_TOO_LARGE' | 'RESPONSE_INVALID';

export class BoundedJsonResponseError extends Error {
  constructor(readonly code: BoundedJsonResponseErrorCode) {
    super(code);
    this.name = 'BoundedJsonResponseError';
  }
}

export async function readBoundedJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || !isJsonContentType(response.headers.get('content-type'))) {
    throw new BoundedJsonResponseError('RESPONSE_INVALID');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      void response.body?.cancel();
      throw new BoundedJsonResponseError('RESPONSE_TOO_LARGE');
    }
  }
  if (!response.body) throw new BoundedJsonResponseError('RESPONSE_INVALID');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new BoundedJsonResponseError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(body) as unknown;
  } catch {
    throw new BoundedJsonResponseError('RESPONSE_INVALID');
  }
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}
