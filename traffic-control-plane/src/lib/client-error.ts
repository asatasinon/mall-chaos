export function isClientNetworkError(cause: unknown): boolean {
  if (!(cause instanceof TypeError)) return false;
  const message = cause.message.toLowerCase();
  return message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network request failed')
    || message.includes('load failed');
}