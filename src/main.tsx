import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme } from './lib/theme';
import './index.css';

/*
 * Before the first paint, so the app never flashes the wrong palette. Read
 * straight from storage rather than waiting for the store to hydrate — a
 * white flash on a dark phone is exactly the sort of detail that makes
 * software feel cheap.
 */
try {
  const stored = localStorage.getItem('ledger.prefs.v1');
  const theme = stored ? JSON.parse(stored)?.state?.theme : undefined;
  applyTheme(theme === 'light' || theme === 'dark' ? theme : 'system');
} catch {
  applyTheme('system');
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
