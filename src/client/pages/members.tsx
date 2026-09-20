import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api, post } from '../api';
import { useWorkspace, usePageContext } from '../shell';
import { ErrorNotice, Loading } from '../ui';
export function MembersPage() {
  const { workspace, user } = useWorkspace(),
    cache = useQueryClient();
  usePageContext([{ label: 'Equipe e acesso' }]);
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const query = useQuery({
    queryKey: ['members', workspace!.id],
    queryFn: () =>
      api<{ id: string; name: string; email: string; role: string }[]>(
        `/workspaces/${workspace!.id}/members`,
      ),
  });
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await post(`/workspaces/${workspace!.id}/members`, {
        email: f.get('email'),
        role: f.get('role'),
      });
      await cache.invalidateQueries({ queryKey: ['members'] });
      setSuccess('Acesso atualizado.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Equipe e acesso</h1>
          <p>Permissões para todos os projetos de {workspace?.name}.</p>
        </div>
        <Users size={30} />
      </div>
      <ErrorNotice error={error || query.error} />
      {success && (
        <p role="status" className="notice success">
          {success}
        </p>
      )}
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : (
          <ul className="member-list">
            {query.data?.map((m) => (
              <li key={m.id}>
                <span className="avatar">{m.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </div>
                <span className="badge">
                  {{ owner: 'Proprietário', editor: 'Editor', viewer: 'Leitor' }[m.role]}
                </span>
                {workspace?.role === 'owner' && m.role !== 'owner' && m.id !== user.id && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remover ${m.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Remover ${m.name} deste espaço?`)) return;
                      setBusy(true);
                      setError(null);
                      try {
                        await api(`/workspaces/${workspace.id}/members/${m.id}`, {
                          method: 'DELETE',
                        });
                        await cache.invalidateQueries({ queryKey: ['members'] });
                        setSuccess('Acesso removido.');
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {workspace?.role === 'owner' && (
        <section className="panel narrow">
          <h2>Adicionar ou atualizar acesso</h2>
          <p>
            A pessoa deve ter uma conta criada. Editores importam e alteram registros; leitores
            consultam e exportam.
          </p>
          <form onSubmit={add}>
            <label>
              E-mail da conta
              <input name="email" type="email" required />
            </label>
            <label>
              Permissão
              <select name="role">
                <option value="viewer">Leitor</option>
                <option value="editor">Editor</option>
              </select>
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar acesso'}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
