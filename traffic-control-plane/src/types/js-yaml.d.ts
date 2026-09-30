declare module 'js-yaml' {
  export function load(input: string): unknown;
  export function loadAll(input: string): unknown[];
  export function dump(input: unknown, options?: Record<string, unknown>): string;
  const yaml: { load: typeof load; loadAll: typeof loadAll; dump: typeof dump };
  export default yaml;
}
