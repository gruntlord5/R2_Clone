import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app';
import { ErrorBoundary } from './components/ErrorBoundary';
import './app.css';
// Import API client to initialize polyfill for browser mode
import { connectWebSocket } from './lib/api-client';

// Connect WebSocket for real-time events (both Electron and Browser)
connectWebSocket();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>
);