import React from 'react';
import ReactDOM from 'react-dom/client';
import { GlobeOverlayPage } from './pages/GlobeOverlayPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobeOverlayPage />
  </React.StrictMode>,
);
