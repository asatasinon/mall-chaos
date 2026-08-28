export function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatBytes(value: number): string {
  if (!value) return 'size pending';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function todayInShanghaiClient(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
