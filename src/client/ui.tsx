import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import { ApiError } from './api';
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <div>
        {error instanceof Error ? error.message : String(error)}
        {error instanceof ApiError && error.status === 401 && (
          <p>
            <a href="/login" target="_blank" rel="noreferrer">
              Entrar novamente em outra aba
            </a>{' '}
            e tentar salvar outra vez.
          </p>
        )}
      </div>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" /> Carregando…
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby="dialog-title">
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
