import type { Field, Value } from '../shared/contracts';
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'VALIDATION_ERROR',
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const invalid = (f: Field): never => {
  throw new AppError(422, `Valor inválido para “${f.label}”.`);
};
export function convertValue(value: Value, f: Field, locale: string): Value {
  if (value === null || value === '') return value;
  const s = String(value);
  switch (f.type) {
    case 'text':
    case 'longtext':
    case 'reference':
    case 'select':
      return s;
    case 'multiselect':
      return Array.isArray(value)
        ? value
        : s
            .split(';')
            .map((x) => x.trim())
            .filter(Boolean);
    case 'number':
    case 'currency': {
      if (typeof value === 'number') return value;
      const pattern =
        locale === 'pt-BR'
          ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/
          : /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
      if (!pattern.test(s)) return invalid(f);
      const n = Number(
        locale === 'pt-BR' ? s.replaceAll('.', '').replace(',', '.') : s.replaceAll(',', ''),
      );
      return Number.isFinite(n) ? n : invalid(f);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const normalized = s.toLowerCase();
      if (['sim', 'true'].includes(normalized)) return true;
      if (['não', 'nao', 'false'].includes(normalized)) return false;
      return invalid(f);
    }
    case 'date': {
      let iso = s;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const [, a, b, y] = m;
        iso = `${y}-${(locale === 'pt-BR' ? b : a).padStart(2, '0')}-${(locale === 'pt-BR' ? a : b).padStart(2, '0')}`;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return invalid(f);
      const d = new Date(iso + 'T00:00:00Z');
      return Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== iso ? invalid(f) : iso;
    }
    case 'datetime': {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) ||
        Number.isNaN(Date.parse(s))
      )
        return invalid(f);
      return new Date(s).toISOString();
    }
  }
}
export function validateValues(
  patch: Record<string, Value>,
  fields: Field[],
  before: Record<string, Value>,
  importing = false,
): Record<string, Value> {
  for (const [key, v] of Object.entries(patch)) {
    const f = fields.find((f) => f.id === key);
    if (!f) throw new AppError(422, 'Campo desconhecido.');
    if (!importing && f.readonly) throw new AppError(422, `“${f.label}” é somente leitura.`);
    if (v === null || v === '') continue;
    if (['number', 'currency'].includes(f.type) && typeof v !== 'number') invalid(f);
    else if (f.type === 'boolean' && typeof v !== 'boolean') invalid(f);
    else if (
      f.type === 'multiselect' &&
      (!Array.isArray(v) || v.some((x) => !f.options.includes(x)))
    )
      invalid(f);
    else if (
      !['number', 'currency', 'boolean', 'multiselect'].includes(f.type) &&
      typeof v !== 'string'
    )
      invalid(f);
    if (f.type === 'select' && !f.options.includes(String(v))) invalid(f);
    if (f.type === 'date' || f.type === 'datetime') convertValue(v, f, 'pt-BR');
  }
  const result = { ...before, ...patch };
  for (const f of fields)
    if (
      f.required &&
      (result[f.id] == null ||
        result[f.id] === '' ||
        (Array.isArray(result[f.id]) && (result[f.id] as string[]).length === 0))
    )
      throw new AppError(422, `Preencha “${f.label}”.`);
  return result;
}
