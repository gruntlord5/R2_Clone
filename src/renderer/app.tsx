import { createHashRouter } from 'react-router';
import Layout from './app/routes/_layout';
import Index, { clientLoader as indexLoader } from './app/routes/_index';
import Settings, { loader as settingsLoader } from './app/routes/settings';
import BackupsLayout from './app/routes/backups._layout';
import BackupsIndex from './app/routes/backups._index';
import { RouteError } from './components/RouteError';

// Using HashRouter for Electron apps as they work better with file:// protocol
// This configuration uses the flat routes structure
export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        element: <Index />,
        loader: indexLoader,
      },
      {
        path: 'settings',
        element: <Settings />,
        loader: settingsLoader,
      },
      {
        path: 'backups',
        element: <BackupsLayout />,
        children: [
          {
            index: true,
            element: <BackupsIndex />,
          },
        ],
      },
    ],
  },
]);