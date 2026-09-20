import { useEffect, useState } from 'react';
import { Link, useParams, useBlocker, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Save, LockKeyhole, Check, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { api, display, formatValue } from '../api';
import { ErrorNotice, Loading, Modal } from '../ui';
import { useWorkspace, usePageContext } from '../shell';
import { FieldInput } from '../fields';
import type { Dataset, DataRecord, Value, Revision, Project } from '../../shared/contracts';
export function RecordPage() {
  const { recordId } = useParams();
  const query = useQuery({
    queryKey: ['record', recordId],
    queryFn: () => api<{ record: DataRecord; dataset: Dataset }>(`/records/${recordId}`),
  });
  return (
    <>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && (
          <Editor key={recordId} initial={query.data.record} dataset={query.data.dataset} />
        )
      )}
    </>
  );
}
/** Ficha em branco: o id é gerado uma vez, então reenviar após falha de rede não duplica. */
export function NewRecordPage() {
  const { datasetId } = useParams();
  const query = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => api<Dataset>(`/datasets/${datasetId}`),
  });
  const [id] = useState(() => crypto.randomUUID());
  return (
    <>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && (
          <Editor
            key={id}
            create
            dataset={query.data}
            initial={{
              id,
              datasetId: query.data.id,
              values: Object.fromEntries(query.data.fields.map((f) => [f.id, null])),
              version: 0,
              updatedAt: new Date().toISOString(),
              source: {
                file: '',
                sheet: '',
                row: 0,
                region: '',
                mappingVersion: query.data.schemaVersion,
                original: {},
              },
            }}
          />
        )
      )}
    </>
  );
}
function Editor({
  initial,
  dataset,
  create = false,
}: {
  initial: DataRecord;
  dataset: Dataset;
  create?: boolean;
}) {
  const { canEdit, setDirty } = useWorkspace(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [record, setRecord] = useState(initial),
    [values, setValues] = useState(initial.values),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [history, setHistory] = useState(false),
    [created, setCreated] = useState(false);
  const dirty = create
    ? !created && Object.values(values).some((v) => v !== null && v !== '')
    : JSON.stringify(values) !== JSON.stringify(record.values);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  const blocker = useBlocker(dirty);
  // Só navega depois que o bloqueio de saída foi liberado pelo novo estado.
  useEffect(() => {
    if (created) navigate(`/registros/${record.id}`, { replace: true });
  }, [created, navigate, record.id]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const related = useQuery({
    queryKey: ['related', record.id],
    queryFn: () =>
      api<{ id: string; dataset: string; titleField: string; values: Record<string, Value> }[]>(
        `/records/${record.id}/related`,
      ),
    enabled: !create,
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (create) {
        const created = await api<DataRecord>(`/datasets/${dataset.id}/records`, {
          method: 'POST',
          body: JSON.stringify({ id: record.id, values }),
        });
        await cache.invalidateQueries({ queryKey: ['records'] });
        await cache.invalidateQueries({ queryKey: ['project', dataset.projectId] });
        setRecord(created);
        setValues(created.values);
        setCreated(true);
        return;
      }
      const patch = Object.fromEntries(
        Object.entries(values).filter(
          ([k, v]) => JSON.stringify(v) !== JSON.stringify(record.values[k]),
        ),
      );
      const updated = await api<DataRecord>(`/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: record.version, values: patch }),
      });
      setRecord(updated);
      setValues(updated.values);
      setSaved(true);
      await cache.invalidateQueries({ queryKey: ['records'] });
      await cache.invalidateQueries({ queryKey: ['history', record.id] });
      cache.setQueryData(['record', record.id], { record: updated, dataset });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const groups = [...new Set(dataset.fields.map((f) => f.group || 'Informações gerais'))];
  const project = useQuery({
    queryKey: ['project', dataset.projectId],
    queryFn: () => api<Project & { datasets: Dataset[] }>(`/projects/${dataset.projectId}`),
  });
  const title = create ? 'Novo registro' : display(record.values[dataset.titleField]);
  usePageContext(
    [
      { label: project.data?.name ?? '…', to: `/projetos/${dataset.projectId}` },
      { label: dataset.name, to: `/projetos/${dataset.projectId}?conjunto=${dataset.id}` },
      { label: title },
    ],
    project.data
      ? { id: project.data.id, name: project.data.name, datasets: project.data.datasets }
      : null,
  );
  return (
    <>
      <div className="record-heading">
        <div>
          <span className="eyebrow">{dataset.name}</span>
          <h1>{title}</h1>
          <div className="row wrap muted">
            {create ? (
              <span>Preencha os campos e salve para criar o registro.</span>
            ) : (
              <>
                <span>
                  ID {dataset.keyField ? display(record.values[dataset.keyField]) : record.id}
                </span>
                <span>Versão {record.version}</span>
              </>
            )}
          </div>
        </div>
        {!create && (
          <button onClick={() => setHistory(true)}>
            <History size={17} />
            Histórico
          </button>
        )}
      </div>
      {!canEdit && (
        <div className="notice">
          <LockKeyhole size={18} />
          Seu acesso é de consulta.
        </div>
      )}
      <ErrorNotice error={error} />
      <form onSubmit={save} className="record-form">
        {groups.map((group) => (
          <section className="panel" key={group}>
            <div className="panel-heading">
              <h2>{group}</h2>
            </div>
            <div className="field-grid">
              {dataset.fields
                .filter((f) => (f.group || 'Informações gerais') === group)
                .map((f) => (
                  <FieldInput
                    key={f.id}
                    field={f}
                    value={values[f.id] ?? null}
                    disabled={!canEdit || busy}
                    onChange={(v) => {
                      setValues({ ...values, [f.id]: v });
                      setSaved(false);
                    }}
                  />
                ))}
            </div>
          </section>
        ))}
        {!create && (
          <details className="source-panel">
            <summary>
              <FileSpreadsheet size={17} />
              Origem e valores originais
            </summary>
            <p>
              {record.source.file} · {record.source.sheet} · linha {record.source.row} · região{' '}
              {record.source.region} · mapeamento v{record.source.mappingVersion}
            </p>
            <dl>
              {dataset.fields.map((f) => (
                <div key={f.id}>
                  <dt>{f.source || f.label}</dt>
                  <dd>{display(record.source.original[f.id])}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {related.data && related.data.length > 0 && (
          <section className="panel">
            <h2>Registros relacionados</h2>
            <p>Até 100 vínculos de outros conjuntos.</p>
            <ul className="related-list">
              {related.data.map((r) => (
                <li key={r.id}>
                  <Link to={`/registros/${r.id}`}>
                    <span>
                      <small>{r.dataset}</small>
                      {display(r.values[r.titleField])}
                    </span>
                    <ExternalLink size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="save-bar">
          <span role="status" className={saved ? 'saved' : ''}>
            {busy ? (
              'Salvando no servidor…'
            ) : dirty ? (
              'Você tem alterações não salvas'
            ) : saved ? (
              <>
                <Check size={17} />
                Alterações salvas
              </>
            ) : create ? (
              'Nada preenchido ainda'
            ) : (
              `Última atualização: ${new Date(record.updatedAt).toLocaleString('pt-BR')}`
            )}
          </span>
          <div className="row">
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Descartar as alterações desta ficha?')) {
                    setValues(record.values);
                    setError(null);
                  }
                }}
              >
                Descartar
              </button>
            )}
            {canEdit && (
              <button className="primary" disabled={!dirty || busy}>
                <Save size={17} />
                {busy ? 'Salvando…' : create ? 'Criar registro' : 'Salvar alterações'}
              </button>
            )}
          </div>
        </div>
      </form>
      {history && (
        <Modal title="Histórico de alterações" onClose={() => setHistory(false)}>
          <HistoryList record={record} dataset={dataset} />
        </Modal>
      )}
      {blocker.state === 'blocked' && (
        <Modal title="Há alterações não salvas" onClose={() => blocker.reset()}>
          <p>Você pode voltar à ficha para salvar ou sair e descartar o preenchimento.</p>
          <div className="form-actions">
            <button onClick={() => blocker.proceed()}>Sair sem salvar</button>
            <button className="primary" onClick={() => blocker.reset()}>
              Continuar editando
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function HistoryList({ record, dataset }: { record: DataRecord; dataset: Dataset }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['history', record.id, page],
    queryFn: () => api<Revision[]>(`/records/${record.id}/history?page=${page}`),
  });
  return (
    <>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        <ol className="history-list">
          {query.data?.map((r) => (
            <li key={r.id}>
              <strong>{r.before ? `Alteração · versão ${r.version}` : 'Importação inicial'}</strong>
              <small>
                {r.author} · {new Date(r.createdAt).toLocaleString('pt-BR')}
              </small>
              {r.before ? (
                <dl>
                  {dataset.fields
                    .filter(
                      (f) => JSON.stringify(r.before?.[f.id]) !== JSON.stringify(r.after[f.id]),
                    )
                    .map((f) => (
                      <div key={f.id}>
                        <dt>{f.label}</dt>
                        <dd>
                          <del>{formatValue(r.before?.[f.id], f)}</del> →{' '}
                          {formatValue(r.after[f.id], f)}
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p>Registro criado a partir do arquivo revisado.</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>Página {page}</span>
        <button disabled={(query.data?.length || 0) < 25} onClick={() => setPage(page + 1)}>
          Próxima
        </button>
      </div>
    </>
  );
}
