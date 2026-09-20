import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleAlert, RefreshCw } from 'lucide-react';
import { display, post } from '../api';
import { ErrorNotice } from '../ui';
import {
  fieldTypes,
  typeLabels,
  type Mapping,
  type Diagnosis,
  type Field,
  type Dataset,
} from '../../shared/contracts';
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
/** Sugere o campo de destino de cada coluna pelo cabeçalho (nome original ou rótulo). */
export function proposeTargets(m: Mapping, dataset: Dataset): Mapping {
  const used = new Set<string>();
  return {
    ...m,
    datasetId: dataset.id,
    fields: m.fields.map((f) => {
      const source = normalize(f.source || f.label);
      const match = dataset.fields.find(
        (d) =>
          !used.has(d.id) && source && [normalize(d.source), normalize(d.label)].includes(source),
      );
      if (match) used.add(match.id);
      return { ...f, target: match?.id };
    }),
  };
}
export function StructureReview({
  diagnosis,
  mappings,
  onChange,
  onHeader,
  existing = [],
}: {
  diagnosis: Diagnosis;
  mappings: Mapping[];
  onChange: (m: Mapping) => void;
  onHeader: (m: Mapping, n: number) => void;
  existing?: Dataset[];
}) {
  const [selected, setSelected] = useState(mappings[0].sheetId),
    [page, setPage] = useState(0);
  const m = mappings.find((m) => m.sheetId === selected)!,
    s = diagnosis.sheets.find((s) => s.id === selected)!;
  return (
    <div className="structure-layout">
      <div className="sheet-tabs" aria-label="Abas do arquivo">
        {mappings.map((m, i) => (
          <button
            className={selected === m.sheetId ? 'active' : ''}
            key={m.sheetId}
            onClick={() => {
              setSelected(m.sheetId);
              setPage(0);
            }}
          >
            <span className="sheet-number">{String(i + 1).padStart(2, '0')}</span>
            <span>
              <strong>{m.name}</strong>
              <small>{diagnosis.sheets[i].rows.length} linhas no arquivo</small>
            </span>
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{s.name}</h2>
            <p>{s.file}</p>
          </div>
          <span className="badge">
            {m.role === 'records'
              ? 'Tabela'
              : m.role === 'lookup'
                ? 'Lista auxiliar'
                : m.role === 'report'
                  ? 'Relatório'
                  : 'Excluída'}
          </span>
        </div>
        <div className="field-grid">
          <label>
            Nome no aplicativo
            <input
              value={m.name}
              maxLength={100}
              onChange={(e) => onChange({ ...m, name: e.target.value })}
            />
          </label>
          <label>
            Como usar esta aba
            <select
              value={m.role}
              onChange={(e) => onChange({ ...m, role: e.target.value as Mapping['role'] })}
            >
              <option value="records">Tabela de registros</option>
              <option value="lookup">Lista auxiliar (fora do menu)</option>
              <option value="report">Resumo / relatório (não importar)</option>
              <option value="exclude">Não importar esta aba</option>
            </select>
          </label>
          {existing.length > 0 && (m.role === 'records' || m.role === 'lookup') && (
            <label className="field-wide">
              Destino no projeto
              <select
                value={m.datasetId || ''}
                onChange={(e) => {
                  const target = existing.find((d) => d.id === e.target.value);
                  onChange(
                    target
                      ? proposeTargets(m, target)
                      : {
                          ...m,
                          datasetId: undefined,
                          fields: m.fields.map((f) => ({ ...f, target: undefined })),
                        },
                  );
                }}
              >
                <option value="">Criar um novo conjunto</option>
                {existing.map((d) => (
                  <option key={d.id} value={d.id} disabled={!d.keyField}>
                    Atualizar “{d.name}”{d.keyField ? '' : ' (sem chave externa)'}
                  </option>
                ))}
              </select>
              <small>
                Ao atualizar, os registros são reconhecidos pela chave externa do conjunto.
                Registros ausentes no arquivo são mantidos; nada é apagado.
              </small>
            </label>
          )}
        </div>
        {s.warnings.map((w, i) => (
          <p key={i} className="notice warning">
            <AlertTriangle size={17} />
            {w}
          </p>
        ))}
        <div className="region-controls">
          <label>
            Linha do cabeçalho
            <input
              type="number"
              min={1}
              max={s.rows.length}
              value={m.headerRow}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= s.rows.length) onHeader(m, n);
              }}
            />
          </label>
          <label>
            Última linha
            <input
              type="number"
              min={m.headerRow}
              max={s.rows.length}
              value={m.endRow}
              onChange={(e) => onChange({ ...m, endRow: Number(e.target.value) })}
            />
          </label>
          <label>
            Primeira coluna
            <input
              type="number"
              min={1}
              max={m.endColumn}
              value={m.startColumn}
              onChange={(e) => onChange({ ...m, startColumn: Number(e.target.value) })}
            />
          </label>
          <label>
            Última coluna
            <input
              type="number"
              min={m.startColumn}
              max={100}
              value={m.endColumn}
              onChange={(e) => onChange({ ...m, endColumn: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="muted small">
          Uma região por aba. Linhas anteriores ao cabeçalho, posteriores à última linha e colunas
          fora da região não serão importadas. Separe outras tabelas em arquivos próprios.
        </p>
        <div className="table-wrap raw-preview">
          <table>
            <caption>
              Arquivo original · linhas {page * 10 + 1} a {Math.min(s.rows.length, page * 10 + 10)}
            </caption>
            <tbody>
              {s.rows.slice(page * 10, page * 10 + 10).map((row, i) => (
                <tr key={i} className={page * 10 + i + 1 === m.headerRow ? 'header-row' : ''}>
                  <th scope="row">{page * 10 + i + 1}</th>
                  {Array.from({ length: Math.max(...s.rows.map((r) => r.length)) }, (_, j) => (
                    <td key={j}>
                      {row[j]?.formula !== undefined && (
                        <span title="Fórmula: valor salvo no arquivo">ƒ </span>
                      )}
                      {display(row[j]?.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span>
            {page + 1} / {Math.ceil(s.rows.length / 10)}
          </span>
          <button disabled={(page + 1) * 10 >= s.rows.length} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      </section>
    </div>
  );
}
export const columnLetter = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export interface Issue {
  sheetId: string;
  fieldId: string | null;
  message: string;
}
type Result = { count: number; issues: Issue[]; snapshot: string };
export function FieldsReview({
  diagnosis,
  mappings,
  onChange,
  batchId,
  locale,
  focus,
  existing = [],
}: {
  diagnosis: Diagnosis;
  mappings: Mapping[];
  onChange: (m: Mapping) => void;
  batchId: string;
  locale: 'pt-BR' | 'en-US';
  focus?: Issue | null;
  existing?: Dataset[];
}) {
  const active = mappings.filter((m) => m.role === 'records' || m.role === 'lookup');
  const [index, setIndex] = useState(0),
    [results, setResults] = useState<Record<string, Result>>({}),
    [checking, setChecking] = useState(false),
    [error, setError] = useState<unknown>();
  const m = active[Math.min(index, active.length - 1)];
  const sheet = diagnosis.sheets.find((s) => s.id === m?.sheetId);
  const snapshot = JSON.stringify({ m, locale });
  const result = m ? results[m.sheetId] : undefined,
    stale = !result || result.snapshot !== snapshot;
  const fieldsRef = useRef<HTMLDivElement>(null);
  async function validate(target: Mapping) {
    setChecking(true);
    setError(null);
    try {
      const r = await post<{ count: number; issues: Issue[] }>(`/imports/${batchId}/validate`, {
        mapping: {
          ...target,
          fields: target.fields.filter((f) => inRegion(target, f)),
        },
        locale,
      });
      setResults((old) => ({
        ...old,
        [target.sheetId]: { ...r, snapshot: JSON.stringify({ m: target, locale }) },
      }));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  }
  // A plataforma avalia cada aba assim que ela é aberta; a pessoa corrige e revalida.
  useEffect(() => {
    if (m && !results[m.sheetId]) void validate(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.sheetId]);
  useEffect(() => {
    if (!focus) return;
    const i = active.findIndex((x) => x.sheetId === focus.sheetId);
    if (i >= 0) setIndex(i);
    setResults((old) => {
      const current = active[i];
      if (!current) return old;
      return {
        ...old,
        [focus.sheetId]: {
          count: old[focus.sheetId]?.count ?? 0,
          issues: [focus],
          snapshot: JSON.stringify({ m: current, locale }),
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  function changeField(id: string, patch: Partial<Field>) {
    onChange({ ...m, fields: m.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  }
  function jump(fieldId: string | null) {
    if (!fieldId) return;
    const el = fieldsRef.current?.querySelector<HTMLElement>(`[data-field="${fieldId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
  }
  if (!m || !sheet)
    return (
      <div className="notice warning">
        <AlertTriangle size={18} />
        Nenhuma aba marcada como tabela ou lista auxiliar. Volte à etapa Estrutura.
      </div>
    );
  const status = (id: string) => {
    const r = results[id];
    if (!r) return 'pending';
    return r.issues.length ? 'issues' : 'ok';
  };
  const issuesFor = (fieldId: string) =>
    stale ? [] : result.issues.filter((i) => i.fieldId === fieldId);
  const target = m.datasetId ? existing.find((d) => d.id === m.datasetId) : undefined;
  return (
    <>
      <nav className="sheet-nav" aria-label="Abas em revisão">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          aria-label="Aba anterior"
        >
          <ArrowLeft size={16} />
        </button>
        <ol>
          {active.map((x, i) => (
            <li key={x.sheetId}>
              <button
                type="button"
                className={`sheet-chip ${status(x.sheetId)} ${i === index ? 'active' : ''}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => setIndex(i)}
              >
                {status(x.sheetId) === 'ok' ? (
                  <Check size={14} />
                ) : status(x.sheetId) === 'issues' ? (
                  <CircleAlert size={14} />
                ) : (
                  <span className="dot" />
                )}
                {x.name}
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={index >= active.length - 1}
          onClick={() => setIndex(index + 1)}
          aria-label="Próxima aba"
        >
          <ArrowRight size={16} />
        </button>
      </nav>
      <section className="panel" key={m.sheetId}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              ABA {index + 1} DE {active.length} ·{' '}
              {m.role === 'lookup' ? 'LISTA AUXILIAR' : 'TABELA'}
            </span>
            <h2>{m.name}</h2>
            <p className="muted small">
              {sheet.file} · {m.fields.filter((f) => inRegion(m, f)).length} campos
              {result && !stale ? ` · ${result.count} registros` : ''}
            </p>
          </div>
          <button type="button" onClick={() => void validate(m)} disabled={checking}>
            <RefreshCw size={16} className={checking ? 'spin' : ''} />
            {checking ? 'Verificando…' : stale && result ? 'Verificar novamente' : 'Verificar aba'}
          </button>
        </div>
        <ErrorNotice error={error} />
        <div
          className={`review-status ${!result || stale ? '' : result.issues.length ? 'issues' : 'ok'}`}
        >
          {checking && !result ? (
            <p>A plataforma está verificando esta aba…</p>
          ) : !result || stale ? (
            <p>
              <AlertTriangle size={17} /> Você alterou esta aba. Clique em “Verificar novamente”
              para ver o que ainda precisa de ajuste.
            </p>
          ) : result.issues.length ? (
            <>
              <p>
                <CircleAlert size={17} />
                <strong>
                  {result.issues.length} ponto{result.issues.length > 1 ? 's' : ''} para arrumar
                  nesta aba
                </strong>
              </p>
              <ul className="issue-list">
                {result.issues.map((i, n) => (
                  <li key={n}>
                    {i.fieldId ? (
                      <button type="button" className="text-button" onClick={() => jump(i.fieldId)}>
                        {i.message}
                      </button>
                    ) : (
                      i.message
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              <Check size={17} /> Aba pronta: {result.count} registros serão importados com esta
              configuração.
            </p>
          )}
        </div>
        {sheet.warnings.length > 0 && (
          <details className="lookup-details">
            <summary>Observações do arquivo ({sheet.warnings.length})</summary>
            <ul className="issue-list">
              {sheet.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        {target ? (
          <div className="notice">
            <div>
              <p>
                Esta aba <strong>atualiza “{target.name}”</strong>. Escolha, para cada coluna, o
                campo que recebe o valor; a chave “
                {target.fields.find((f) => f.id === target.keyField)?.label}” identifica o registro.
              </p>
              <label className="conflict-policy">
                Se um registro foi editado no Preenche e o arquivo traz outro valor
                <select
                  value={m.conflicts}
                  onChange={(e) =>
                    onChange({ ...m, conflicts: e.target.value as Mapping['conflicts'] })
                  }
                >
                  <option value="keep">Manter a edição feita no Preenche</option>
                  <option value="file">Usar o valor do arquivo</option>
                </select>
              </label>
            </div>
          </div>
        ) : (
          <div className="field-grid mapping-settings">
            <label>
              Campo usado no título da ficha
              <select
                value={m.titleField}
                onChange={(e) => onChange({ ...m, titleField: e.target.value })}
              >
                {m.fields
                  .filter((f) => inRegion(m, f))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Chave externa única (neste conjunto)
              <select
                value={m.keyField || ''}
                onChange={(e) => onChange({ ...m, keyField: e.target.value || null })}
              >
                <option value="">Sem chave externa · usar ID interno</option>
                {m.fields
                  .filter((f) => inRegion(m, f) && f.type === 'text')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        {!target && (
          <p className="muted small">
            Identificadores devem permanecer como texto. A chave selecionada não pode estar vazia ou
            repetida. Não escolha um nome sem conferir sua unicidade.
          </p>
        )}
        <div className="mapping-fields" ref={fieldsRef}>
          {m.fields
            .filter((f) => inRegion(m, f))
            .map((f) => {
              const problems = issuesFor(f.id);
              return (
                <div
                  className={`mapping-field ${problems.length ? 'has-issue' : ''}`}
                  key={f.id}
                  data-field={f.id}
                >
                  <div className="source-column">
                    <small>COLUNA {columnLetter(Number(f.id.slice(1)))} NO ARQUIVO</small>
                    <strong>{f.source || 'Sem cabeçalho'}</strong>
                    <span>→</span>
                  </div>
                  {target ? (
                    <label className="field-wide-2">
                      Campo de destino
                      <select
                        value={f.target || ''}
                        aria-invalid={problems.length > 0 || undefined}
                        onChange={(e) => changeField(f.id, { target: e.target.value || undefined })}
                      >
                        <option value="">Não importar esta coluna</option>
                        {target.fields.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label} · {typeLabels[d.type]}
                            {d.id === target.keyField ? ' · chave' : ''}
                            {d.required ? ' · obrigatório' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label>
                      Nome do campo
                      <input
                        value={f.label}
                        maxLength={100}
                        aria-invalid={problems.length > 0 || undefined}
                        onChange={(e) => changeField(f.id, { label: e.target.value })}
                      />
                    </label>
                  )}
                  {!target && (
                    <label>
                      Tipo
                      <select
                        value={f.type}
                        onChange={(e) =>
                          changeField(f.id, { type: e.target.value as Field['type'] })
                        }
                      >
                        {fieldTypes.map((t) => (
                          <option key={t} value={t}>
                            {typeLabels[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!target && (
                    <label>
                      Grupo na ficha
                      <input
                        value={f.group}
                        onChange={(e) => changeField(f.id, { group: e.target.value })}
                      />
                    </label>
                  )}
                  {!target && (
                    <div className="field-flags">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => changeField(f.id, { required: e.target.checked })}
                        />
                        Obrigatório
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={f.readonly}
                          onChange={(e) => changeField(f.id, { readonly: e.target.checked })}
                        />
                        Só leitura
                      </label>
                    </div>
                  )}
                  {!target && (f.type === 'select' || f.type === 'multiselect') && (
                    <label className="field-wide">
                      Opções (separadas por ponto e vírgula)
                      <input
                        value={f.options.join(';')}
                        onChange={(e) => changeField(f.id, { options: e.target.value.split(';') })}
                      />
                    </label>
                  )}
                  {!target && f.type === 'currency' && (
                    <label>
                      Moeda
                      <select
                        value={f.currency}
                        onChange={(e) =>
                          changeField(f.id, { currency: e.target.value as Field['currency'] })
                        }
                      >
                        <option>BRL</option>
                        <option>USD</option>
                        <option>EUR</option>
                      </select>
                    </label>
                  )}
                  {!target && f.type === 'reference' && (
                    <label className="field-wide">
                      Conjunto e chave de destino
                      <select
                        value={f.reference ? `${f.reference.sheetId}/${f.reference.fieldId}` : ''}
                        onChange={(e) => {
                          const [sheetId, fieldId] = e.target.value.split('/');
                          changeField(f.id, {
                            reference: sheetId ? { sheetId, fieldId } : undefined,
                          });
                        }}
                      >
                        <option value="">Selecione um conjunto com chave definida</option>
                        {active
                          .filter((t) => t.keyField && t.sheetId !== m.sheetId)
                          .map((t) => (
                            <option key={t.sheetId} value={`${t.sheetId}/${t.keyField}`}>
                              {t.name} → {t.fields.find((f) => f.id === t.keyField)?.label}
                            </option>
                          ))}
                      </select>
                      <small>
                        A correspondência dos valores será verificada no servidor. Relação de muitos
                        registros para um.
                      </small>
                    </label>
                  )}
                  {problems.map((p, n) => (
                    <p className="field-issue field-wide" key={n} role="alert">
                      <CircleAlert size={15} />
                      {p.message}
                    </p>
                  ))}
                </div>
              );
            })}
        </div>
        <div className="sheet-nav-footer">
          <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <ArrowLeft size={16} /> Aba anterior
          </button>
          <span className="muted small">
            {active.filter((x) => status(x.sheetId) === 'ok').length} de {active.length} abas
            prontas
          </span>
          <button
            type="button"
            disabled={index >= active.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            Próxima aba <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </>
  );
}
const inRegion = (m: Mapping, f: Field) =>
  Number(f.id.slice(1)) >= m.startColumn && Number(f.id.slice(1)) <= m.endColumn;
