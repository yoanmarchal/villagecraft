import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { consumeSharedVillageLink } from './store/shareLink';
import { hideAppLoader } from './loader';
import { installVillagecraftApi } from './api/villagecraftApi';

// Une erreur non rattrapée (WebGL indisponible…) laisserait sinon l'écran de chargement en place pour toujours.
window.addEventListener('error', hideAppLoader);
window.addEventListener('unhandledrejection', hideAppLoader);

consumeSharedVillageLink();
// API stable pour les outils externes (serveur MCP, scripts) : voir src/api/villagecraftApi.ts.
installVillagecraftApi();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
