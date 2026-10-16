import './twitchConnection.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlobeSettingsPage } from './pages/GlobeSettingsPage';
import './styles.css';
import { completeTwitchPopupCallback } from './lib/twitchBrowserConnect';

void completeTwitchPopupCallback().then(handled => {
  if (handled) return;
  ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobeSettingsPage />
  </React.StrictMode>,
);
});
