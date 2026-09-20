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
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.message || body?.message || 'Não foi possível conectar. Tente novamente.',
      response.status,
      body?.error?.code || body?.code || 'ERROR',
      body?.error?.details,
    );
  return body as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
import type { Field } from '../shared/contracts';
/** Valor formatado para leitura no idioma da interface, conforme o tipo do campo. */
export function formatValue(v: unknown, f?: Pick<Field, 'type' | 'currency'>): string {
  if (v === null || v === undefined || v === '') return display(v);
  if (f && (f.type === 'number' || f.type === 'currency') && typeof v === 'number')
    return f.type === 'currency'
      ? v.toLocaleString('pt-BR', { style: 'currency', currency: f.currency })
      : v.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
  if (f?.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  if (f?.type === 'datetime' && typeof v === 'string' && !Number.isNaN(Date.parse(v)))
    return new Date(v).toLocaleString('pt-BR');
  return display(v);
}
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
