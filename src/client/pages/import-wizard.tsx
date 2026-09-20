import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  UploadCloud,
  FileSpreadsheet,
  Check,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { api, post, display, ApiError } from '../api';
import { ErrorNotice } from '../ui';
import { useWorkspace, usePageContext } from '../shell';
import { StructureReview, FieldsReview, proposeTargets, type Issue } from './import-review';
import type {
  Diagnosis,
  Mapping,
  Field,
  Value,
  Confirmation,
  Dataset,
  Project,
  ReconcilePlan,
} from '../../shared/contracts';
type Preview = {
  name: string;
  count: number;
  fields: Field[];
  samples: Record<string, Value>[];
  outsideRows: number;
  blankRows: number;
  existing: boolean;
  plan: (ReconcilePlan & { conflictCount: number; missingCount: number }) | null;
};
const steps = ['Arquivo', 'Estrutura', 'Campos e relações', 'Prévia', 'Confirmar'];
export function ImportWizard() {
  const { workspace, canEdit } = useWorkspace(),
    navigate = useNavigate(),
    cache = useQueryClient(),
    [params] = useSearchParams();
  const [step, setStep] = useState(0),
    [files, setFiles] = useState<File[]>([]),
    [batch, setBatch] = useState<{ id: string; diagnosis: Diagnosis }>(),
    [mappings, setMappings] = useState<Mapping[]>([]);
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [locale, setLocale] = useState<'pt-BR' | 'en-US'>('pt-BR'),
    [ack, setAck] = useState(false),
    [preview, setPreview] = useState<Preview[]>([]),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false),
    [focus, setFocus] = useState<Issue | null>(null),
    [link, setLink] = useState(params.get('link') || ''),
    [sourceUrl, setSourceUrl] = useState('');
  const projectId = params.get('projeto') || undefined;
  usePageContext([{ label: projectId ? 'Adicionar planilha' : 'Novo projeto' }]);
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project & { datasets: Dataset[] }>(`/projects/${projectId}`),
    enabled: !!projectId,
  });
  const existing = (project.data?.datasets ?? []).filter(
    (d) => d.role === 'records' || d.role === 'lookup',
  );
  const refreshDataset = params.get('conjunto');
  /** Lê a planilha pública do Google e entra no fluxo normal de revisão. */
  async function readLink(target?: Dataset) {
    if (!link.trim()) throw new Error('Cole o link da planilha do Google Sheets.');
    const b = await api<{ id: string; diagnosis: Diagnosis; sourceUrl: string; name: string }>(
      `/workspaces/${workspace!.id}/imports/link`,
      { method: 'POST', body: JSON.stringify({ url: link }) },
    );
    setBatch(b);
    setSourceUrl(b.sourceUrl);
    setFiles([]);
    if (!name.trim()) setName(b.name.replace(/\.xlsx$/i, ''));
    // Atualização a partir do link do conjunto: a aba de mesmo nome (ou a única) recebe o destino.
    setMappings(
      b.diagnosis.mappings.map((m, i, all) =>
        target && (m.name === target.name || all.length === 1) ? proposeTargets(m, target) : m,
      ),
    );
  }
  useEffect(() => {
    if (!refreshDataset || !project.data || batch || busy) return;
    const target = existing.find((d) => d.id === refreshDataset);
    if (!target?.sourceUrl) return;
    setBusy(true);
    setLink(target.sourceUrl);
    setName(`Atualização de ${target.name}`);
    readLink(target)
      .then(() => setStep(1))
      .catch(setError)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDataset, project.data]);
  const config = (): Confirmation => ({
    name,
    description,
    locale,
    acknowledged: true,
    projectId,
    mappings: mappings.map((m) => ({
      ...m,
      fields: m.fields.filter(
        (f) => Number(f.id.slice(1)) >= m.startColumn && Number(f.id.slice(1)) <= m.endColumn,
      ),
    })),
  });
  function selectFiles(selected: File[]) {
    setError(null);
    if (
      selected.length > 5 ||
      selected.some((f) => f.size > 5 * 1024 * 1024 || !/\.(xlsx|csv)$/i.test(f.name))
    ) {
      setError(new Error('Escolha até 5 arquivos CSV ou XLSX, de até 5 MB cada.'));
      return;
    }
    setFiles(selected);
    if (!name && selected[0]) setName(selected[0].name.replace(/\.(csv|xlsx)$/i, ''));
  }
  async function next() {
    setBusy(true);
    setError(null);
    try {
      if (step === 0) {
        if (!name.trim()) throw new Error('Dê um nome ao projeto.');
        if (link.trim() && !files.length) await readLink();
        else {
          if (!files.length)
            throw new Error('Selecione um arquivo ou cole um link do Google Sheets.');
          const form = new FormData();
          files.forEach((f) => form.append('files', f));
          const b = await api<{ id: string; diagnosis: Diagnosis }>(
            `/workspaces/${workspace!.id}/imports`,
            { method: 'POST', body: form },
          );
          setBatch(b);
          setSourceUrl('');
          setMappings(b.diagnosis.mappings);
        }
      }
      if (step === 2) setPreview(await post<Preview[]>(`/imports/${batch!.id}/preview`, config()));
      if (step === 4) {
        if (!ack) throw new Error('Revise e confirme as decisões de importação.');
        const result = await post<{ projectId: string }>(`/imports/${batch!.id}/confirm`, config());
        await cache.invalidateQueries({ queryKey: ['projects'] });
        await cache.invalidateQueries({ queryKey: ['project', result.projectId] });
        navigate(`/projetos/${result.projectId}`);
        return;
      }
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e);
      // O servidor aponta aba e coluna; a revisão abre direto nesse ponto.
      const d = e instanceof ApiError ? e.details : undefined;
      if (step === 2 && d && typeof d.sheetId === 'string')
        setFocus({
          sheetId: d.sheetId,
          fieldId: typeof d.fieldId === 'string' ? d.fieldId : null,
          message: String(d.message ?? (e as Error).message),
        });
    } finally {
      setBusy(false);
    }
  }
  function change(m: Mapping) {
    setMappings((old) => old.map((x) => (x.sheetId === m.sheetId ? m : x)));
    setAck(false);
  }
  async function header(m: Mapping, n: number) {
    setBusy(true);
    setError(null);
    try {
      const proposed = await post<Mapping>(`/imports/${batch!.id}/mapping`, {
        sheetId: m.sheetId,
        headerRow: n,
      });
      change({ ...proposed, name: m.name, role: m.role });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!canEdit)
    return (
      <div className="notice">
        Seu perfil permite apenas consulta. Peça a um editor para importar.
      </div>
    );
  return (
    <>
      <Link to={projectId ? `/projetos/${projectId}` : '/'} className="back-link">
        <ArrowLeft size={15} />
        {projectId ? 'Voltar ao projeto' : 'Projetos'}
      </Link>
      <div className="page-heading">
        <div>
          <h1>{projectId ? 'Adicionar planilha' : 'Novo projeto'}</h1>
          <p>
            Envie o arquivo, revise a estrutura e os campos, confira a prévia e publique. Nada é
            importado antes da sua confirmação.
          </p>
        </div>
      </div>
      <ol className="stepper" aria-label="Etapas da importação">
        {steps.map((label, i) => (
          <li
            key={label}
            className={i === step ? 'current' : i < step ? 'complete' : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            <span>{i < step ? <Check size={16} /> : i + 1}</span>
            <b>{label}</b>
          </li>
        ))}
      </ol>
      <ErrorNotice error={error} />
      <fieldset disabled={busy} className="wizard-fieldset">
        {step === 0 && (
          <section className="panel upload-panel">
            <div className="panel-heading">
              <div>
                <h2>Comece pelo seu arquivo</h2>
                <p>Excel com várias abas ou CSV. A estrutura será revisada no próximo passo.</p>
              </div>
            </div>
            <label
              className={`dropzone ${drag ? 'dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                selectFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <UploadCloud size={38} />
              <strong>Arraste sua planilha até aqui</strong>
              <span>
                ou <u>escolha os arquivos</u> no computador
              </span>
              <small>.xlsx ou .csv · até 5 MB por arquivo · até 5 arquivos</small>
              <input
                type="file"
                accept=".xlsx,.csv"
                multiple
                aria-label="Escolher planilhas"
                onChange={(e) => selectFiles(Array.from(e.target.files || []))}
              />
            </label>
            <div className="link-import">
              <label>
                Ou cole o link de uma planilha do Google Sheets
                <input
                  type="url"
                  value={link}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  onChange={(e) => setLink(e.target.value)}
                />
                <small>
                  A planilha precisa estar compartilhada como “Qualquer pessoa com o link”. Todas as
                  abas são lidas; o link fica salvo para atualizar o conjunto depois.
                </small>
              </label>
            </div>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i}>
                    <FileSpreadsheet size={20} />
                    <strong>{f.name}</strong>
                    <span>{(f.size / 1024).toFixed(1)} KB</span>
                    <Check size={17} />
                  </li>
                ))}
              </ul>
            )}
            <div className="field-grid">
              <label>
                {projectId ? 'Nome deste lote' : 'Nome do projeto'}
                <input
                  value={name}
                  required
                  maxLength={100}
                  placeholder="Ex.: Clientes e contatos"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Descrição (opcional)
                <input
                  value={description}
                  maxLength={500}
                  placeholder="Para que sua equipe vai usar este projeto?"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>
            <p className="notice">
              <ShieldCheck size={18} />A análise é feita no servidor, sem enviar dados a terceiros.
              O arquivo não é retido após a publicação.
            </p>
          </section>
        )}
        {step === 1 && batch && (
          <>
            <div className="notice warning">
              <AlertTriangle size={18} />
              <div>
                {batch.diagnosis.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </div>
            <StructureReview
              diagnosis={batch.diagnosis}
              mappings={mappings}
              onChange={change}
              onHeader={(m, n) => void header(m, n)}
              existing={existing}
            />
          </>
        )}
        {step === 2 && (
          <>
            <div className="panel locale-panel">
              <div>
                <h2>Campos claros, dados preservados</h2>
                <p>
                  Uma aba por vez: a plataforma verifica cada uma e aponta a coluna que precisa de
                  ajuste. Ao continuar, todas as abas são validadas juntas.
                </p>
              </div>
              <label>
                Localidade dos valores
                <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}>
                  <option value="pt-BR">Brasil · DD/MM/AAAA · 1.234,56</option>
                  <option value="en-US">Estados Unidos · MM/DD/AAAA · 1,234.56</option>
                </select>
              </label>
            </div>
            <FieldsReview
              diagnosis={batch!.diagnosis}
              mappings={mappings}
              onChange={change}
              batchId={batch!.id}
              locale={locale}
              focus={focus}
              existing={existing}
            />
          </>
        )}
        {step === 3 && (
          <>
            <div className="notice success">
              <Check size={18} />
              Estrutura validada. Confira a quantidade de registros e os valores convertidos.
            </div>
            {preview.map((p, i) => (
              <section className="panel" key={i}>
                <div className="panel-heading">
                  <h2>{p.name}</h2>
                  <span className="badge">
                    {p.existing ? 'Atualização · ' : ''}
                    {p.count} registros no arquivo
                  </span>
                </div>
                {p.plan && (
                  <div className="plan-grid">
                    <div>
                      <strong>{p.plan.inserts}</strong>
                      <span>novos registros</span>
                    </div>
                    <div>
                      <strong>{p.plan.updates}</strong>
                      <span>atualizados pelo arquivo</span>
                    </div>
                    <div>
                      <strong>{p.plan.unchanged}</strong>
                      <span>sem alteração</span>
                    </div>
                    <div className={p.plan.conflictCount ? 'warn' : ''}>
                      <strong>{p.plan.conflictCount}</strong>
                      <span>editados no Preenche e diferentes no arquivo</span>
                    </div>
                    <div>
                      <strong>{p.plan.missingCount}</strong>
                      <span>ausentes no arquivo (mantidos)</span>
                    </div>
                  </div>
                )}
                {p.plan && p.plan.conflictCount > 0 && (
                  <p className="notice warning">
                    <AlertTriangle size={17} />
                    <span>
                      Conflitos: {p.plan.conflicts.join(', ')}
                      {p.plan.conflictCount > p.plan.conflicts.length ? '…' : ''}.{' '}
                      {mappings.find(
                        (m) =>
                          m.datasetId &&
                          existing.find((d) => d.id === m.datasetId)?.name === p.name,
                      )?.conflicts === 'file'
                        ? 'O arquivo vai sobrescrever essas edições.'
                        : 'As edições feitas no Preenche serão mantidas.'}
                    </span>
                  </p>
                )}
                {p.plan && p.plan.missingCount > 0 && (
                  <p className="muted small">
                    Ausentes no arquivo: {p.plan.missing.join(', ')}
                    {p.plan.missingCount > p.plan.missing.length ? '…' : ''}. Continuam no conjunto;
                    nenhum registro é apagado por reimportação.
                  </p>
                )}
                <p className="muted small">
                  {p.outsideRows} linhas fora da região de dados (inclui cabeçalho) · {p.blankRows}{' '}
                  linhas vazias dentro da região. Nenhum valor não vazio é descartado sem escolha da
                  região.
                </p>
                {p.samples.map((row, i) => (
                  <div className="preview-record" key={i}>
                    <h3>Prévia da ficha {i + 1}</h3>
                    <dl className="preview-fields">
                      {p.fields.map((f) => (
                        <div key={f.id}>
                          <dt>
                            {f.label}
                            {f.readonly ? ' · só leitura' : ''}
                          </dt>
                          <dd>{display(row[f.id])}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
        {step === 4 && (
          <section className="panel confirmation">
            <span className="confirmation-icon">
              <Check size={28} />
            </span>
            <h2>Pronto para ganhar uma nova forma</h2>
            <p>A publicação disponibiliza os dados aos membros autorizados deste espaço.</p>
            <div className="confirmation-stats">
              <div>
                <strong>{preview.length}</strong>
                <span>conjuntos de dados</span>
              </div>
              <div>
                <strong>{preview.reduce((n, p) => n + p.count, 0)}</strong>
                <span>registros</span>
              </div>
              <div>
                <strong>
                  {mappings.filter((m) => m.role === 'report' || m.role === 'exclude').length}
                </strong>
                <span>abas não importadas</span>
              </div>
            </div>
            <p>
              Esquema versão 1 · {locale} · sem recálculo de fórmulas
              {sourceUrl ? ' · origem: Google Sheets (link salvo)' : ''}
            </p>
            {projectId && (
              <p className="notice">
                {preview.some((p) => p.existing)
                  ? 'Conjuntos existentes serão atualizados pela chave externa; os demais serão criados. Nenhum registro é apagado.'
                  : 'Serão criados novos conjuntos neste projeto.'}
              </p>
            )}
            <label className="checkbox-label acknowledge">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Revisei as regiões, as abas excluídas, os tipos, as chaves e as relações. Confirmo que
              esta é a fonte correta dos registros.
            </label>
            <p className="muted small">
              Os valores originais e a origem de cada registro serão preservados. O arquivo binário
              não será retido.
            </p>
          </section>
        )}
      </fieldset>
      <div className="wizard-actions">
        <div>
          {step > 0 && (
            <button
              disabled={busy}
              onClick={() => {
                setStep(step - 1);
                setError(null);
                setAck(false);
              }}
            >
              <ArrowLeft size={16} />
              Voltar
            </button>
          )}
        </div>
        <span className="muted small">Etapa {step + 1} de 5</span>
        <button
          className="primary"
          disabled={busy || (step === 4 && !ack)}
          onClick={() => void next()}
        >
          {busy
            ? 'Processando…'
            : step === 4
              ? 'Publicar aplicação'
              : step === 2
                ? 'Validar e ver prévia'
                : 'Continuar'}
          {!busy && <ArrowRight size={17} />}
        </button>
      </div>
    </>
  );
}
