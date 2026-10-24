import React from 'react';
import { createRoot } from 'react-dom/client';
import { Launcher } from './LauncherApp';
import './launcher.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Launcher />
  </React.StrictMode>,
);
