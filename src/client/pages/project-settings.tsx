import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, FileSpreadsheet, RefreshCw, Link2 } from 'lucide-react';
import { api } from '../api';
import { ErrorNotice, Loading } from '../ui';
import { useWorkspace, usePageContext } from '../shell';
import { typeLabels, type Dataset, type Project, type SyncState } from '../../shared/contracts';
type Batch = {
  id: string;
  createdAt: string;
  author: string;
  locale: string;
  sheets: { name: string; role: string; fields: number }[];
};
const roleLabel: Record<string, string> = {
  records: 'Tabela',
  lookup: 'Lista auxiliar',
  report: 'Relatório (não importada)',
  exclude: 'Não importada',
};
export function ProjectSettingsPage() {
  const { projectId } = useParams(),
    { canEdit } = useWorkspace();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project & { datasets: Dataset[] }>(`/projects/${projectId}`),
  });
  const batches = useQuery({
    queryKey: ['imports', projectId],
    queryFn: () => api<Batch[]>(`/projects/${projectId}/imports`),
  });
  usePageContext(
    project.data
      ? [{ label: project.data.name, to: `/projetos/${projectId}` }, { label: 'Configurações' }]
      : [],
    project.data
      ? { id: project.data.id, name: project.data.name, datasets: project.data.datasets }
      : null,
  );
  if (project.isPending) return <Loading />;
  if (!project.data) return <ErrorNotice error={project.error} />;
  return (
    <>
      <Link className="back-link" to={`/projetos/${projectId}`}>
        <ArrowLeft size={15} />
        Voltar ao projeto
      </Link>
      <div className="page-heading">
        <div>
          <h1>Configurações</h1>
          <p>Nome do projeto, rótulos dos campos e histórico de importações.</p>
        </div>
      </div>
      {!canEdit && (
        <div className="notice">Seu acesso é de consulta: as alterações estão desativadas.</div>
      )}
      <ProjectForm project={project.data} disabled={!canEdit} />
      {project.data.datasets
        .filter((d) => d.role === 'records' || d.role === 'lookup')
        .map((d) => (
          <div key={d.id}>
            <DatasetForm dataset={d} disabled={!canEdit} />
            {d.sourceUrl && <SyncPanel dataset={d} disabled={!canEdit} />}
          </div>
        ))}
      <section className="panel">
        <div className="panel-heading">
          <h2>Importações publicadas</h2>
        </div>
        <ErrorNotice error={batches.error} />
        {batches.isPending ? (
          <Loading />
        ) : (
          <ul className="batch-list">
            {batches.data?.map((b) => (
              <li key={b.id}>
                <FileSpreadsheet size={18} />
                <div>
                  <strong>
                    {new Date(b.createdAt).toLocaleString('pt-BR')} · {b.author}
                  </strong>
                  <small>Localidade {b.locale} · esquema v1</small>
                  <ul>
                    {b.sheets.map((s, i) => (
                      <li key={i}>
                        {s.name} — {roleLabel[s.role] ?? s.role}
                        {s.role === 'records' || s.role === 'lookup' ? ` · ${s.fields} campos` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Cada registro guarda arquivo, aba, linha e valores originais (veja “Origem” na ficha).
          Para atualizar um conjunto com um arquivo novo, use “Adicionar planilha” e escolha o
          conjunto como destino: os registros são reconhecidos pela chave externa e nada é apagado.
        </p>
      </section>
    </>
  );
}
function ProjectForm({ project, disabled }: { project: Project; disabled: boolean }) {
  const cache = useQueryClient();
  const [name, setName] = useState(project.name),
    [description, setDescription] = useState(project.description),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description }),
      });
      await cache.invalidateQueries({ queryKey: ['project', project.id] });
      await cache.invalidateQueries({ queryKey: ['projects'] });
      setStatus('Projeto atualizado.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-heading">
        <h2>Projeto</h2>
      </div>
      <fieldset disabled={disabled || busy} className="wizard-fieldset">
        <div className="field-grid">
          <label>
            Nome
            <input
              value={name}
              required
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Descrição
            <input
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <span role="status" className="muted small">
          {status}
        </span>
        <button className="primary" disabled={disabled || busy}>
          <Save size={16} />
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
function DatasetForm({ dataset, disabled }: { dataset: Dataset; disabled: boolean }) {
  const cache = useQueryClient();
  const [name, setName] = useState(dataset.name),
    [fields, setFields] = useState(
      dataset.fields.map((f) => ({ id: f.id, label: f.label, group: f.group })),
    ),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await api(`/datasets/${dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, fields }),
      });
      await cache.invalidateQueries({ queryKey: ['project', dataset.projectId] });
      await cache.invalidateQueries({ queryKey: ['dataset', dataset.id] });
      await cache.invalidateQueries({ queryKey: ['record'] });
      setStatus('Conjunto atualizado.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-heading">
        <div>
          <h2>{dataset.name}</h2>
          <p className="muted small">
            {dataset.role === 'lookup' ? 'Lista auxiliar' : 'Tabela de registros'} · esquema v
            {dataset.schemaVersion}
          </p>
        </div>
      </div>
      <fieldset disabled={disabled || busy} className="wizard-fieldset">
        <label>
          Nome do conjunto
          <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Coluna no arquivo</th>
                <th>Tipo</th>
                <th>Rótulo</th>
                <th>Grupo na ficha</th>
              </tr>
            </thead>
            <tbody>
              {dataset.fields.map((f, i) => (
                <tr key={f.id}>
                  <td>{f.source || `Coluna ${f.id.slice(1)}`}</td>
                  <td>
                    {typeLabels[f.type]}
                    {f.readonly ? ' · só leitura' : ''}
                  </td>
                  <td>
                    <input
                      aria-label={`Rótulo de ${f.source || f.label}`}
                      value={fields[i].label}
                      required
                      maxLength={100}
                      onChange={(e) =>
                        setFields(
                          fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Grupo de ${f.source || f.label}`}
                      value={fields[i].group}
                      maxLength={100}
                      onChange={(e) =>
                        setFields(
                          fields.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <p className="muted small">
        Tipo, opções e obrigatoriedade fazem parte do esquema publicado e não mudam aqui: alterar
        exige nova versão com análise dos valores existentes.
      </p>
      <ErrorNotice error={error} />
      <div className="form-actions">
        <span role="status" className="muted small">
          {status}
        </span>
        <button className="primary" disabled={disabled || busy}>
          <Save size={16} />
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

function SyncPanel({ dataset, disabled }: { dataset: Dataset; disabled: boolean }) {
  const cache = useQueryClient();
  const [enabled, setEnabled] = useState(!!dataset.syncEnabled),
    [state, setState] = useState<SyncState | null | undefined>(dataset.syncState),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Dataset>(`/datasets/${dataset.id}/sync`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(!!saved.syncEnabled);
      await cache.invalidateQueries({ queryKey: ['project', dataset.projectId] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      setState(await api<SyncState>(`/datasets/${dataset.id}/sync/run`, { method: 'POST' }));
      await cache.invalidateQueries({ queryKey: ['records'] });
      await cache.invalidateQueries({ queryKey: ['project', dataset.projectId] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel sync-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Link2 size={18} /> Google Sheets de origem
          </h2>
          <p className="muted small">
            <a href={dataset.sourceUrl!} target="_blank" rel="noreferrer">
              Abrir planilha ↗
            </a>
          </p>
        </div>
        <button type="button" onClick={() => void runNow()} disabled={disabled || busy}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          {busy ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Sincronizar automaticamente (a cada 15 minutos, enquanto o servidor estiver ativo)
      </label>
      <p className="muted small">
        A sincronização inclui registros novos e aplica alterações do arquivo; registros editados no
        Preenche são mantidos e nada é apagado. Se o cabeçalho da planilha mudar, ela para e avisa
        aqui — use “Atualizar do Google Sheets” na lista para revisar.
      </p>
      <ErrorNotice error={error} />
      {state?.lastRunAt && (
        <p role="status" className={`notice ${state.status === 'error' ? 'warning' : 'success'}`}>
          Última execução em {new Date(state.lastRunAt).toLocaleString('pt-BR')}: {state.message}
        </p>
      )}
    </section>
  );
}
