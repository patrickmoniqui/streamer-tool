import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlobeSettingsPage } from './pages/GlobeSettingsPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobeSettingsPage />
  </React.StrictMode>,
);
