import { createRoot } from 'react-dom/client';
import SidebarApp from './SidebarApp';
import { ErrorBoundary } from './ErrorBoundary';
import './sidebar.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <SidebarApp />
  </ErrorBoundary>,
);
