import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './shell';
import { Login } from './pages/login';
import { Dashboard } from './pages/dashboard';
import { ProjectPage } from './pages/project';
import { RecordPage, NewRecordPage } from './pages/record';
import { Loading } from './ui';
// Telas de uso ocasional carregam sob demanda: o pacote inicial fica com login, painel, lista e ficha.
const ImportWizard = lazy(() =>
  import('./pages/import-wizard').then((m) => ({ default: m.ImportWizard })),
);
const ProjectSettingsPage = lazy(() =>
  import('./pages/project-settings').then((m) => ({ default: m.ProjectSettingsPage })),
);
const MembersPage = lazy(() => import('./pages/members').then((m) => ({ default: m.MembersPage })));
const lazyPage = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;
import './styles.css';
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'importar', element: lazyPage(<ImportWizard />) },
      { path: 'projetos/:projectId', element: <ProjectPage /> },
      { path: 'registros/:recordId', element: <RecordPage /> },
      { path: 'conjuntos/:datasetId/novo', element: <NewRecordPage /> },
      { path: 'projetos/:projectId/configuracoes', element: lazyPage(<ProjectSettingsPage />) },
      { path: 'equipe', element: lazyPage(<MembersPage />) },
      {
        path: '*',
        element: (
          <div className="empty">
            <h1>Página não encontrada</h1>
            <a href="/">Voltar aos projetos</a>
          </div>
        ),
      },
    ],
  },
]);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
