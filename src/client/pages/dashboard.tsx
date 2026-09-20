import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  ArrowUpRight,
  FileSpreadsheet,
  FolderOpen,
  Database,
  Users,
  Package,
} from 'lucide-react';
import { api } from '../api';
import { useWorkspace, usePageContext } from '../shell';
import { ErrorNotice, Loading } from '../ui';
import type { Project } from '../../shared/contracts';
export function Dashboard() {
  const { workspace, canEdit } = useWorkspace();
  usePageContext([{ label: 'Projetos' }]);
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['projects', workspace!.id],
    queryFn: () => api<Project[]>(`/workspaces/${workspace!.id}/projects`),
  });
  const projects = query.data || [],
    filtered = projects.filter((p) =>
      (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Projetos</h1>
          <p>Aplicações publicadas neste espaço. Abra uma para consultar e editar registros.</p>
        </div>
        {canEdit && (
          <Link className="button primary" to="/importar">
            <Plus size={18} />
            Novo projeto
          </Link>
        )}
      </div>
      <div className="stats-strip">
        <div>
          <FolderOpen />
          <span>
            <strong>{projects.length.toLocaleString('pt-BR')}</strong> projetos
          </span>
        </div>
        <div>
          <Database />
          <span>
            <strong>
              {projects.reduce((n, p) => n + p.datasetCount, 0).toLocaleString('pt-BR')}
            </strong>{' '}
            conjuntos de dados
          </span>
        </div>
        <div>
          <FileSpreadsheet />
          <span>
            <strong>
              {projects.reduce((n, p) => n + p.recordCount, 0).toLocaleString('pt-BR')}
            </strong>{' '}
            registros organizados
          </span>
        </div>
      </div>
      <section>
        <div className="section-toolbar">
          <div className="section-title">
            <h2>Todos os projetos</h2>
            <span className="count">{projects.length}</span>
          </div>
          <label className="search">
            <Search size={18} />
            <span className="sr-only">Buscar projetos</span>
            <input
              placeholder="Buscar projeto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <ErrorNotice error={query.error} />
        {query.isPending ? (
          <Loading />
        ) : filtered.length ? (
          <div className="project-grid">
            {filtered.map((p, i) => (
              <Link key={p.id} to={`/projetos/${p.id}`} className="project-card">
                <div className="project-card-top">
                  <span className={`project-icon tone-${i % 3}`}>
                    <FolderOpen size={23} />
                  </span>
                  <ArrowUpRight size={20} />
                </div>
                <h3>{p.name}</h3>
                <p>{p.description || 'Sem descrição.'}</p>
                <div className="project-meta">
                  <span>{p.datasetCount} conjuntos</span>
                  <span>{p.recordCount.toLocaleString('pt-BR')} registros</span>
                </div>
                <footer>
                  <span className="status-dot" />
                  Publicado <span>{new Date(p.createdAt).toLocaleDateString('pt-BR')}</span>
                </footer>
              </Link>
            ))}
            {canEdit && (
              <Link to="/importar" className="new-project-card">
                <span>
                  <Plus size={24} />
                </span>
                <h3>Novo projeto</h3>
                <p>Importar uma planilha</p>
              </Link>
            )}
          </div>
        ) : (
          <div className="empty-projects">
            <span className="project-icon">
              <FolderOpen size={26} />
            </span>
            <div>
              <h3>{search ? 'Nenhum projeto encontrado' : 'Nenhum projeto ainda'}</h3>
              <p>
                {search
                  ? 'Tente buscar por outro nome.'
                  : 'Importe um CSV ou Excel: você revisa a estrutura, os campos e as relações antes de publicar.'}
              </p>
            </div>
            {canEdit && !search && (
              <Link to="/importar" className="button primary">
                <Plus size={17} />
                Novo projeto
              </Link>
            )}
          </div>
        )}
      </section>
      {!projects.length && !query.isPending && (
        <section className="examples">
          <div>
            <h2>Exemplos para testar</h2>
            <p>Arquivos fictícios que percorrem o fluxo completo.</p>
          </div>
          <a href="/examples/clientes.csv" download>
            <span className="example-icon">
              <Users size={21} />
            </span>
            <div>
              <strong>Relacionamento com clientes</strong>
              <small>CSV · Cadastro e contato</small>
            </div>
            <ArrowUpRight size={19} />
          </a>
          <a href="/examples/estoque.xlsx" download>
            <span className="example-icon peach">
              <Package size={21} />
            </span>
            <div>
              <strong>Controle de estoque</strong>
              <small>Excel · Produtos e categorias</small>
            </div>
            <ArrowUpRight size={19} />
          </a>
        </section>
      )}
    </>
  );
}
