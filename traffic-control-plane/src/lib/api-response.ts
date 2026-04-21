// Uniform API response envelope matching Java ApiResponse<T>

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data };
}

export function error(code: number, message: string): ApiResponse<null> {
  return { code, message, data: null };
}

export function jsonOk<T>(data: T, status = 200) {
  return Response.json(ok(data), { status });
}

export function jsonError(code: number, message: string, status = 400) {
  return Response.json(error(code, message), { status });
}
