import { MSG } from '../types';

const HOST_ID = 'oak-extension-host';

let persistObserver: MutationObserver | null = null;

function shouldShowUI(): boolean {
  const isGreenhouse = location.hostname.endsWith('greenhouse.io');
  return window === window.top || isGreenhouse;
}

function mountTarget(): HTMLElement | null {
  return document.body;
}

function mountOakUI(): void {
  if (!shouldShowUI() || document.getElementById(HOST_ID)) return;

  const target = mountTarget();
  if (!target) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-oak-ui', 'true');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;';
  target.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  // Floating action button
  const fab = document.createElement('button');
  fab.className = 'oak-fab';
  fab.title = 'Open Oak';
  fab.innerHTML = `<span class="oak-fab-icon">🌳</span>`;
  shadow.appendChild(fab);

  // Sidebar panel
  const sidebar = document.createElement('div');
  sidebar.className = 'oak-sidebar';
  sidebar.innerHTML = `
    <div class="oak-sidebar-header">
      <span class="oak-logo">🌳 Oak</span>
      <button class="oak-close" title="Close">✕</button>
    </div>
    <iframe class="oak-sidebar-frame" src="${chrome.runtime.getURL('sidebar.html')}" allow="clipboard-read; clipboard-write"></iframe>
  `;
  shadow.appendChild(sidebar);

  const closeBtn = sidebar.querySelector('.oak-close') as HTMLButtonElement;
  let open = false;

  function setOpen(value: boolean) {
    open = value;
    sidebar.classList.toggle('open', open);
    fab.classList.toggle('hidden', open);
  }

  fab.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));

  window.addEventListener('message', (e) => {
    if (e.data?.type === MSG.SIDEBAR_CLOSE) setOpen(false);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.TOGGLE_SIDEBAR) {
      setOpen(!open);
    }
  });
}

function ensureOakUI(): void {
  mountOakUI();

  if (persistObserver) return;

  persistObserver = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID) && shouldShowUI()) {
      mountOakUI();
    }
  });

  const root = document.documentElement;
  persistObserver.observe(root, { childList: true, subtree: true });
}

export function injectOakUI(): void {
  if (mountTarget()) {
    ensureOakUI();
    return;
  }

  document.addEventListener('DOMContentLoaded', ensureOakUI, { once: true });
}

const STYLES = `
  :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  .oak-fab {
    position: fixed;
    bottom: 36px;
    left: 24px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    pointer-events: auto;
    background: linear-gradient(135deg, #7c6cf0, #5b4cdb);
    box-shadow: 0 4px 20px rgba(124, 108, 240, 0.45), 0 2px 8px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    z-index: 2147483647;
  }

  .oak-fab:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 28px rgba(124, 108, 240, 0.55);
  }

  .oak-fab.hidden { opacity: 0; pointer-events: none; transform: scale(0.8); }

  .oak-fab-icon { font-size: 24px; line-height: 1; }

  .oak-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    height: 100vh;
    pointer-events: auto;
    background: #1a1d27;
    box-shadow: -4px 0 32px rgba(0,0,0,0.35);
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    z-index: 2147483646;
    border-left: 1px solid #2e3344;
  }

  .oak-sidebar.open { transform: translateX(0); }

  .oak-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #2e3344;
    background: #14161e;
    flex-shrink: 0;
  }

  .oak-logo {
    font-size: 15px;
    font-weight: 600;
    color: #e8eaef;
  }

  .oak-close {
    background: none;
    border: none;
    color: #8b92a5;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }

  .oak-close:hover { background: #2e3344; color: #e8eaef; }

  .oak-sidebar-frame {
    flex: 1;
    border: none;
    width: 100%;
    background: #1a1d27;
  }
`;
