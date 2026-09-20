import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, display } from './api';
import type { Field, Value, DataRecord } from '../shared/contracts';
export function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: Field;
  value: Value;
  onChange: (v: Value) => void;
  disabled?: boolean;
}) {
  const f = field;
  const common = {
    id: `field-${f.id}`,
    disabled,
    required: f.required,
    'aria-describedby': f.readonly ? `hint-${f.id}` : undefined,
  };
  return (
    <label className={f.type === 'longtext' ? 'field-wide' : ''} htmlFor={`field-${f.id}`}>
      <span>
        {f.label}
        {f.required && <span className="required"> *</span>}
        {f.type === 'currency' && <small> ({f.currency})</small>}
      </span>
      {f.readonly ? (
        <>
          <output id={`field-${f.id}`} className="readonly">
            {display(value)}
          </output>
          <small id={`hint-${f.id}`}>Somente leitura · valor do arquivo, sem recálculo</small>
        </>
      ) : f.type === 'reference' ? (
        <ReferenceInput field={f} value={value} onChange={onChange} disabled={disabled} />
      ) : f.type === 'longtext' ? (
        <textarea
          {...common}
          rows={4}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : f.type === 'select' || f.type === 'boolean' ? (
        <select
          {...common}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : f.type === 'boolean'
                  ? e.target.value === 'true'
                  : e.target.value,
            )
          }
        >
          <option value="">Não informado</option>
          {f.type === 'boolean' ? (
            <>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </>
          ) : (
            f.options.map((o) => <option key={o}>{o}</option>)
          )}
        </select>
      ) : f.type === 'multiselect' ? (
        <select
          {...common}
          multiple
          value={Array.isArray(value) ? value : []}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={
            f.type === 'date' ? 'date' : ['number', 'currency'].includes(f.type) ? 'number' : 'text'
          }
          step={['number', 'currency'].includes(f.type) ? 'any' : undefined}
          maxLength={10000}
          placeholder={f.type === 'datetime' ? '2026-09-17T10:00:00-04:00' : undefined}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : ['number', 'currency'].includes(f.type)
                  ? Number(e.target.value)
                  : e.target.value,
            )
          }
        />
      )}
      {f.type === 'datetime' && <small>Informe data, hora e fuso (ISO 8601).</small>}
      {f.type === 'multiselect' && <small>Use Ctrl ou ⌘ para selecionar mais de uma opção.</small>}
    </label>
  );
}
function ReferenceInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: Field;
  value: Value;
  onChange: (v: Value) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['options', field.reference?.sheetId, search],
    queryFn: () =>
      api<{ items: DataRecord[] }>(
        `/datasets/${field.reference!.sheetId}/records?q=${encodeURIComponent(search)}`,
      ),
    enabled: !!field.reference,
  });
  const selected = useQuery({
    queryKey: ['reference', value],
    queryFn: () =>
      api<{ record: DataRecord; dataset: { titleField: string } }>(`/records/${value}`),
    enabled: !!value,
  });
  return (
    <span className="reference-input">
      <input
        disabled={disabled}
        aria-label={`Pesquisar opções de ${field.label}`}
        placeholder="Pesquisar opções…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        id={`field-${field.id}`}
        required={field.required}
        disabled={disabled}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Não informado</option>
        {value && !list.data?.items.some((r) => r.id === value) && (
          <option value={String(value)}>
            {selected.data
              ? display(selected.data.record.values[selected.data.dataset.titleField])
              : 'Registro selecionado'}
          </option>
        )}
        {list.data?.items.map((r) => (
          <option key={r.id} value={r.id}>
            {display(r.values[field.reference!.fieldId])} ·{' '}
            {Object.values(r.values)
              .filter((v) => typeof v === 'string')
              .slice(0, 2)
              .join(' — ')}
          </option>
        ))}
      </select>
      {value && <Link to={`/registros/${value}`}>Abrir registro relacionado ↗</Link>}
      {list.error && (
        <small role="alert">Não foi possível carregar opções. Tente pesquisar novamente.</small>
      )}
    </span>
  );
}
