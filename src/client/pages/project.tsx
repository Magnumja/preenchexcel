import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Download,
  ChevronRight,
  Database,
  Plus,
  SlidersHorizontal,
  Settings,
  Columns3,
  RefreshCw,
} from 'lucide-react';
import { api, display, formatValue } from '../api';
import { ErrorNotice, Loading, Empty } from '../ui';
import { useWorkspace, usePageContext } from '../shell';
import type { Dataset, DataRecord, Project } from '../../shared/contracts';
export function ProjectPage() {
  const { projectId } = useParams(),
    { canEdit } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<Project & { datasets: Dataset[] }>(`/projects/${projectId}`),
  });
  const datasets = query.data?.datasets || [],
    visible = datasets.filter((d) => d.role === 'records');
  const chosen = datasets.find((d) => d.id === params.get('conjunto')) || visible[0] || datasets[0];
  usePageContext(
    query.data
      ? [
          { label: query.data.name, to: `/projetos/${projectId}` },
          ...(chosen ? [{ label: chosen.name }] : []),
        ]
      : [],
    query.data ? { id: query.data.id, name: query.data.name, datasets } : null,
  );
  return (
    <>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && (
          <>
            <div className="page-heading">
              <div>
                <h1>{query.data.name}</h1>
                <p>
                  {query.data.description ||
                    `${visible.length} conjunto${visible.length === 1 ? '' : 's'} de registros · publicado em ${new Date(query.data.createdAt).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <div className="row wrap">
                {canEdit && (
                  <Link className="button" to={`/importar?projeto=${projectId}`}>
                    <Plus size={17} />
                    Adicionar planilha
                  </Link>
                )}
                <Link className="button" to={`/projetos/${projectId}/configuracoes`}>
                  <Settings size={17} />
                  Configurações
                </Link>
              </div>
            </div>
            <div className="dataset-tabs" role="navigation" aria-label="Conjuntos de dados">
              {visible.map((d) => (
                <button
                  key={d.id}
                  className={chosen?.id === d.id ? 'active' : ''}
                  onClick={() => setParams({ conjunto: d.id })}
                >
                  <Database size={16} />
                  {d.name}
                  <span>{d.recordCount}</span>
                </button>
              ))}
            </div>
            {datasets.some((d) => d.role === 'lookup') && (
              <details className="lookup-details">
                <summary>
                  Listas auxiliares ({datasets.filter((d) => d.role === 'lookup').length})
                </summary>
                <div className="row wrap">
                  {datasets
                    .filter((d) => d.role === 'lookup')
                    .map((d) => (
                      <button key={d.id} onClick={() => setParams({ conjunto: d.id })}>
                        {d.name}
                      </button>
                    ))}
                </div>
              </details>
            )}
            {chosen ? (
              <RecordList key={chosen.id} dataset={chosen} canEdit={canEdit} />
            ) : (
              <Empty title="Nenhum conjunto publicado">
                <p>Adicione uma planilha para começar.</p>
              </Empty>
            )}
          </>
        )
      )}
    </>
  );
}
const columnsKey = (id: string) => `columns:${id}`;
function readColumns(dataset: Dataset): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(columnsKey(dataset.id)) || 'null');
    if (Array.isArray(saved) && saved.every((id) => dataset.fields.some((f) => f.id === id)))
      return saved;
  } catch {
    /* preferência indisponível: usa o padrão */
  }
  return [
    dataset.titleField,
    ...dataset.fields.filter((f) => f.id !== dataset.titleField).map((f) => f.id),
  ].slice(0, 5);
}
function RecordList({ dataset, canEdit }: { dataset: Dataset; canEdit: boolean }) {
  const [search, setSearch] = useState(''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [sort, setSort] = useState(dataset.titleField),
    [direction, setDirection] = useState('asc');
  const [filterField, setFilterField] = useState(''),
    [filterValue, setFilterValue] = useState(''),
    [filters, setFilters] = useState(false),
    [columnPicker, setColumnPicker] = useState(false),
    [visibleIds, setVisibleIds] = useState(() => readColumns(dataset));
  const filterDef = dataset.fields.find((f) => f.id === filterField);
  const filterMode =
    filterDef && ['select', 'boolean', 'reference'].includes(filterDef.type) ? 'exact' : 'contains';
  function toggleColumn(id: string) {
    const next = visibleIds.includes(id)
      ? visibleIds.filter((x) => x !== id)
      : dataset.fields.filter((f) => f.id === id || visibleIds.includes(f.id)).map((f) => f.id);
    if (!next.length) return;
    setVisibleIds(next);
    try {
      localStorage.setItem(columnsKey(dataset.id), JSON.stringify(next));
    } catch {
      /* sem armazenamento local */
    }
  }
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const params = new URLSearchParams({
    q,
    page: String(page),
    sort,
    direction,
    filterField,
    filterValue: filterField ? filterValue : '',
    filterMode,
  });
  const query = useQuery({
    queryKey: ['records', dataset.id, params.toString()],
    queryFn: () =>
      api<{
        items: DataRecord[];
        total: number;
        pageSize: number;
        references: Record<string, string>;
      }>(`/datasets/${dataset.id}/records?${params}`),
  });
  const columns = [
    dataset.fields.find((f) => f.id === dataset.titleField)!,
    ...dataset.fields.filter((f) => f.id !== dataset.titleField && visibleIds.includes(f.id)),
  ];
  const cell = (r: DataRecord, f: (typeof columns)[number]) =>
    f.type === 'reference' && r.values[f.id]
      ? (query.data?.references[String(r.values[f.id])] ?? 'Registro relacionado')
      : formatValue(r.values[f.id], f);
  return (
    <section className="records-section">
      <div className="section-toolbar">
        <div>
          <h2>{dataset.name}</h2>
          <p className="muted">
            {query.data
              ? `${query.data.total.toLocaleString('pt-BR')} registro${query.data.total === 1 ? '' : 's'}${q || filterField ? ' encontrados' : ''}`
              : '…'}
          </p>
        </div>
        <div className="row wrap">
          <a className="button" href={`/api/datasets/${dataset.id}/export`}>
            <Download size={16} />
            Exportar CSV
          </a>
          {canEdit && dataset.sourceUrl && (
            <Link
              className="button"
              to={`/importar?projeto=${dataset.projectId}&conjunto=${dataset.id}`}
              title="Lê o Google Sheets de origem e mostra o que mudou antes de aplicar"
            >
              <RefreshCw size={16} />
              Atualizar do Google Sheets
            </Link>
          )}
          {canEdit && (
            <Link className="button primary" to={`/conjuntos/${dataset.id}/novo`}>
              <Plus size={16} />
              Novo registro
            </Link>
          )}
        </div>
      </div>
      <div className="list-toolbar">
        <label className="search grow">
          <Search size={18} />
          <span className="sr-only">Buscar registros</span>
          <input
            placeholder="Buscar em todos os campos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button aria-expanded={filters} onClick={() => setFilters(!filters)}>
          <SlidersHorizontal size={16} />
          Filtros
        </button>
        <button aria-expanded={columnPicker} onClick={() => setColumnPicker(!columnPicker)}>
          <Columns3 size={16} />
          Colunas
        </button>
        <label className="compact-label">
          Ordenar
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            {dataset.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Inverter ordenação"
          onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
        >
          {direction === 'asc' ? '↑' : '↓'}
        </button>
      </div>
      {filters && (
        <div className="filter-bar">
          <label>
            Campo
            <select
              value={filterField}
              onChange={(e) => {
                setFilterField(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Sem filtro</option>
              {dataset.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {filterMode === 'exact' ? 'Igual a' : 'Contém'}
            {filterDef?.type === 'boolean' ? (
              <select
                value={filterValue}
                onChange={(e) => {
                  setFilterValue(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Qualquer</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            ) : filterDef?.type === 'select' ? (
              <select
                value={filterValue}
                onChange={(e) => {
                  setFilterValue(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Qualquer</option>
                {filterDef.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                value={filterValue}
                disabled={!filterDef}
                onChange={(e) => {
                  setFilterValue(e.target.value);
                  setPage(1);
                }}
                placeholder={filterDef?.type === 'reference' ? 'ID do registro' : 'Texto…'}
              />
            )}
          </label>
          <button
            onClick={() => {
              setFilterField('');
              setFilterValue('');
            }}
          >
            Limpar
          </button>
        </div>
      )}
      {columnPicker && (
        <fieldset className="column-picker">
          <legend>Colunas visíveis na lista</legend>
          {dataset.fields.map((f) => (
            <label key={f.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={f.id === dataset.titleField || visibleIds.includes(f.id)}
                disabled={f.id === dataset.titleField}
                onChange={() => toggleColumn(f.id)}
              />
              {f.label}
            </label>
          ))}
        </fieldset>
      )}
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty title="Nenhum registro encontrado">
          <p>Altere a busca ou os filtros para tentar novamente.</p>
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  {columns.map((f) => (
                    <th key={f.id}>{f.label}</th>
                  ))}
                  <th>
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((r) => (
                  <tr key={r.id}>
                    {columns.map((f, i) => (
                      <td key={f.id}>
                        {i === 0 ? (
                          <Link to={`/registros/${r.id}`} className="record-title">
                            {formatValue(r.values[f.id], f)}
                          </Link>
                        ) : f.type === 'reference' && r.values[f.id] ? (
                          <Link to={`/registros/${r.values[f.id]}`}>{cell(r, f)}</Link>
                        ) : (
                          <span
                            className={
                              f.type === 'boolean' || f.type === 'select' ? 'value-tag' : ''
                            }
                          >
                            {formatValue(r.values[f.id], f)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td>
                      <Link
                        aria-label={`Abrir ${display(r.values[dataset.titleField])}`}
                        to={`/registros/${r.id}`}
                      >
                        <ChevronRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="record-cards">
            {query.data.items.map((r) => (
              <Link to={`/registros/${r.id}`} key={r.id}>
                <strong>
                  {display(r.values[dataset.titleField])}
                  <ChevronRight size={18} />
                </strong>
                {columns.slice(1, 3).map((f) => (
                  <span key={f.id}>
                    <small>{f.label}</small>
                    {cell(r, f)}
                  </span>
                ))}
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="pagination">
        <span>
          Página {page} de {Math.max(1, Math.ceil((query.data?.total || 0) / 25))}
        </span>
        <div className="row">
          <button disabled={page === 1 || query.isPending} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <button
            disabled={!query.data || page * 25 >= query.data.total}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </section>
  );
}
