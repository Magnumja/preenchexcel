import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './shell';
import { Login } from './pages/login';
import { Dashboard } from './pages/dashboard';
import { ImportWizard } from './pages/import-wizard';
import { ProjectPage } from './pages/project';
import { RecordPage, NewRecordPage } from './pages/record';
import { ProjectSettingsPage } from './pages/project-settings';
import { MembersPage } from './pages/members';
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
      { path: 'importar', element: <ImportWizard /> },
      { path: 'projetos/:projectId', element: <ProjectPage /> },
      { path: 'registros/:recordId', element: <RecordPage /> },
      { path: 'conjuntos/:datasetId/novo', element: <NewRecordPage /> },
      { path: 'projetos/:projectId/configuracoes', element: <ProjectSettingsPage /> },
      { path: 'equipe', element: <MembersPage /> },
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
