import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SidebarApp from './SidebarApp';
import './sidebar.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidebarApp />
  </StrictMode>,
);
