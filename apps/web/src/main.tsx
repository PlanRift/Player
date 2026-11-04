import React from 'react';
import ReactDOM from 'react-dom/client';
import { subsonicClient } from '@player/shared';
import App from './App';
import './index.css';

if (import.meta.env.VITE_NAVIDROME_URL) {
  subsonicClient.updateConfig({
    serverUrl: import.meta.env.VITE_NAVIDROME_URL,
    username: import.meta.env.VITE_NAVIDROME_USER || 'localtest',
    password: import.meta.env.VITE_NAVIDROME_PASSWORD || 'localtest-password',
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
