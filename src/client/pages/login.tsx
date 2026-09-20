import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import { post, ApiError } from '../api';
const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre com ela.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este e-mail. Entre com ela.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 10 caracteres.',
  INVALID_EMAIL: 'Informe um e-mail válido.',
};
import { Brand } from '../shell';
import { ErrorNotice } from '../ui';
export function Login() {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const navigate = useNavigate(),
    cache = useQueryClient();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await post(register ? '/auth/sign-up/email' : '/auth/sign-in/email', {
        name: f.get('name'),
        email: f.get('email'),
        password: f.get('password'),
      });
      cache.clear();
      navigate('/');
    } catch (e) {
      setError(
        e instanceof ApiError && messages[e.code]
          ? new ApiError(messages[e.code], e.status, e.code)
          : e,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">DA PLANILHA PARA O DIA A DIA</span>
          <h1>
            Seus dados,
            <br />
            em outra forma.
          </h1>
          <p>
            Transforme tabelas em aplicações claras.
            <br />
            Mais tempo para trabalhar. Menos tempo procurando a célula certa.
          </p>
          <div className="sheet-illustration" aria-hidden="true">
            <div className="sheet-mini">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <ArrowRight />
            <div className="form-mini">
              <span />
              <b />
              <span />
              <b />
              <em>
                <Check size={14} /> Salvo
              </em>
            </div>
          </div>
        </div>
        <small>Preenche · Planilhas que viram possibilidades</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">SEU NOVO JEITO DE ORGANIZAR</span>
          <h2>{register ? 'Crie sua conta' : 'Bom ter você por aqui'}</h2>
          <p>{register ? 'Comece com um espaço só seu.' : 'Entre para continuar de onde parou.'}</p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Seu nome
                <input name="name" autoComplete="name" required maxLength={100} />
              </label>
            )}
            <label>
              E-mail
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <label>
              Senha
              <input
                type="password"
                name="password"
                minLength={10}
                autoComplete={register ? 'new-password' : 'current-password'}
                required
              />
              {register && <small>Use pelo menos 10 caracteres.</small>}
            </label>
            <ErrorNotice error={error} />
            <button className="primary full" disabled={busy}>
              {busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="switch-auth">
            {register ? 'Já tem uma conta?' : 'Primeira vez aqui?'}{' '}
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError(null);
              }}
            >
              {register ? 'Entrar' : 'Criar conta'}
            </button>
          </p>
          <p className="privacy-copy">
            Suas planilhas ficam no seu espaço. Nenhum dado é enviado a serviços de IA nesta versão.
          </p>
        </div>
      </section>
    </div>
  );
}
