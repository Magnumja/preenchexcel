export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    credentials: 'same-origin',
    headers:
      options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.message || body?.message || 'Não foi possível conectar. Tente novamente.',
      response.status,
      body?.error?.code || 'ERROR',
      body?.error?.details,
    );
  return body as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const display = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? 'Não informado'
    : Array.isArray(v)
      ? v.join(', ')
      : typeof v === 'boolean'
        ? v
          ? 'Sim'
          : 'Não'
        : String(v);
