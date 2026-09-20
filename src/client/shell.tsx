import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PanelsTopLeft,
  Plus,
  Users,
  LogOut,
  PanelLeftClose,
  Menu,
  Database,
  FolderOpen,
} from 'lucide-react';
import { api, post, ApiError } from './api';
import { ErrorNotice, Loading, Modal } from './ui';
import type { Workspace } from '../shared/contracts';
type User = { id: string; name: string; email: string };
export type Crumb = { label: string; to?: string };
// Projeto aberto: alimenta a lateral (conjuntos) e o caminho no topo.
export type OpenProject = {
  id: string;
  name: string;
  datasets: { id: string; name: string; role: string }[];
};
const Context = createContext<{
  workspace: Workspace | undefined;
  user: User;
  canEdit: boolean;
  setDirty: (v: boolean) => void;
  setCrumbs: (c: Crumb[]) => void;
  setProject: (p: OpenProject | null) => void;
}>({
  workspace: undefined,
  user: { id: '', name: '', email: '' },
  canEdit: false,
  setDirty: () => {},
  setCrumbs: () => {},
  setProject: () => {},
});
export const useWorkspace = () => useContext(Context);
/** Define o caminho mostrado no topo enquanto a página estiver montada. */
export function usePageContext(crumbs: Crumb[], project: OpenProject | null = null) {
  const { setCrumbs, setProject } = useContext(Context);
  const key = JSON.stringify({ crumbs, project });
  useEffect(() => {
    setCrumbs(crumbs);
    setProject(project);
    return () => {
      setCrumbs([]);
      setProject(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs, setProject]);
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      preenche<span className="brand-dot">.</span>
    </span>
  );
}
export function Shell() {
  const navigate = useNavigate(),
    cache = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me'), retry: false });
  const spaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<Workspace[]>('/workspaces'),
    enabled: !!me.data,
  });
  const [dirty, setDirty] = useState(false),
    [crumbs, setCrumbs] = useState<Crumb[]>([]),
    [project, setProject] = useState<OpenProject | null>(null);
  const location = useLocation();
  const confirmLeave = () =>
    !dirty || window.confirm('Descartar as alterações não salvas desta ficha?');
  const [selected, setSelected] = useState(sessionStorage.getItem('workspace') || '');
  const [newSpace, setNewSpace] = useState(false),
    [menu, setMenu] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const workspace = spaces.data?.find((w) => w.id === selected) || spaces.data?.[0];
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      navigate('/login', { replace: true });
  }, [me.error, navigate]);
  if (me.isPending) return <Loading />;
  if (!me.data) return <ErrorNotice error={me.error} />;
  async function createSpace(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = new FormData(e.currentTarget).get('name');
      const w = await post<Workspace>('/workspaces', { name });
      setSelected(w.id);
      sessionStorage.setItem('workspace', w.id);
      await cache.invalidateQueries({ queryKey: ['workspaces'] });
      setNewSpace(false);
      navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        workspace,
        user: me.data,
        canEdit: !!workspace && workspace.role !== 'viewer',
        setDirty,
        setCrumbs,
        setProject,
      }}
    >
      <div className="app-shell">
        <a className="skip-link" href="#main">
          Pular para o conteúdo
        </a>
        <aside className={`sidebar ${menu ? 'open' : ''}`}>
          <Link to="/" className="brand-link" aria-label="Preenche, página inicial">
            <Brand />
          </Link>
          <div className="workspace-switch">
            <label htmlFor="workspace">ESPAÇO DE TRABALHO</label>
            <select
              id="workspace"
              value={workspace?.id || ''}
              onChange={(e) => {
                if (!confirmLeave()) return;
                setSelected(e.target.value);
                sessionStorage.setItem('workspace', e.target.value);
                navigate('/');
              }}
            >
              {!workspace && <option value="">Nenhum espaço</option>}
              {spaces.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (confirmLeave()) setNewSpace(true);
              }}
              className="sidebar-small"
            >
              <Plus size={14} /> Criar espaço
            </button>
          </div>
          <nav aria-label="Navegação principal" onClick={() => setMenu(false)}>
            <NavLink to="/" end>
              <PanelsTopLeft size={19} />
              Projetos
            </NavLink>
            {workspace?.role !== 'viewer' && (
              <NavLink to="/importar">
                <Plus size={19} />
                Novo projeto
              </NavLink>
            )}
            <NavLink to="/equipe">
              <Users size={19} />
              Equipe e acesso
            </NavLink>
          </nav>
          {project && (
            <nav className="sidebar-project" aria-label={`Conjuntos de ${project.name}`}>
              <NavLink
                to={`/projetos/${project.id}`}
                end
                className={({ isActive }) =>
                  `project-link ${isActive && !location.search ? 'active' : ''}`
                }
              >
                <FolderOpen size={17} />
                <strong>{project.name}</strong>
              </NavLink>
              {project.datasets
                .filter((d) => d.role === 'records')
                .map((d) => (
                  <NavLink
                    key={d.id}
                    to={`/projetos/${project.id}?conjunto=${d.id}`}
                    className={() =>
                      location.pathname === `/projetos/${project.id}` &&
                      new URLSearchParams(location.search).get('conjunto') === d.id
                        ? 'active'
                        : ''
                    }
                  >
                    <Database size={16} />
                    {d.name}
                  </NavLink>
                ))}
            </nav>
          )}
          <div className="sidebar-spacer" />
          <div className="user-box">
            <span className="avatar">{me.data.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{me.data.name}</strong>
              <small>Conta pessoal</small>
            </div>
            <button
              aria-label="Sair da conta"
              onClick={async () => {
                if (!confirmLeave()) return;
                try {
                  await post('/auth/sign-out', {});
                  cache.clear();
                  navigate('/login');
                } catch (e) {
                  setError(e);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="topbar">
            <button
              className="mobile-menu icon-button"
              aria-label={menu ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <PanelLeftClose /> : <Menu />}
            </button>
            <nav className="breadcrumb-top" aria-label="Caminho">
              <ol>
                <li>
                  {crumbs.length ? (
                    <Link to="/">{workspace?.name || 'Espaço'}</Link>
                  ) : (
                    <strong>{workspace?.name || 'Comece por aqui'}</strong>
                  )}
                </li>
                {crumbs.map((c, i) => (
                  <li key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                    <span aria-hidden="true">/</span>
                    {c.to && i < crumbs.length - 1 ? (
                      <Link to={c.to}>{c.label}</Link>
                    ) : (
                      <strong>{c.label}</strong>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <span className="topbar-role">
              {workspace
                ? { owner: 'Proprietário', editor: 'Editor', viewer: 'Leitor' }[workspace.role]
                : ''}
            </span>
          </header>
          <main id="main" tabIndex={-1}>
            <ErrorNotice error={error || spaces.error} />
            {spaces.isPending ? (
              <Loading />
            ) : !workspace ? (
              <section className="welcome">
                <span className="eyebrow">PRIMEIRO ACESSO</span>
                <h1>Crie seu espaço de trabalho</h1>
                <p>
                  Um espaço reúne projetos e define quem pode acessá-los. Depois, importe a primeira
                  planilha.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    if (confirmLeave()) setNewSpace(true);
                  }}
                >
                  <Plus size={18} />
                  Criar meu espaço
                </button>
              </section>
            ) : (
              <Outlet key={workspace.id} />
            )}
          </main>
        </div>
        {newSpace && (
          <Modal title="Novo espaço de trabalho" onClose={() => setNewSpace(false)}>
            <form onSubmit={createSpace}>
              <p>Reúna seus projetos e escolha quem pode acessar os dados.</p>
              <label>
                Nome do espaço
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="Ex.: Minha equipe"
                  autoFocus
                />
              </label>
              <ErrorNotice error={error} />
              <div className="form-actions">
                <button type="button" onClick={() => setNewSpace(false)}>
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? 'Criando…' : 'Criar espaço'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </Context.Provider>
  );
}
