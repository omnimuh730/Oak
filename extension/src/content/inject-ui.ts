import type { PipelineProgress } from '../../../shared/pipeline-types';
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
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;';
  target.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'oak-fab';
  fab.title = 'Run Oak: Fetch → Analyze → Fill';
  fab.type = 'button';
  fab.innerHTML = `
    <span class="oak-fab-icon">🌳</span>
    <span class="oak-fab-status" hidden></span>
  `;
  shadow.appendChild(fab);

  // Sidebar kept for toolbar toggle / debug; FAB no longer opens it.
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
  const statusEl = fab.querySelector('.oak-fab-status') as HTMLSpanElement;
  const iconEl = fab.querySelector('.oak-fab-icon') as HTMLSpanElement;

  let open = false;
  let pipelineBusy = false;

  function setOpen(value: boolean) {
    open = value;
    sidebar.classList.toggle('open', open);
  }

  function applyProgress(progress: PipelineProgress) {
    const busy =
      progress.phase === 'fetching' ||
      progress.phase === 'analyzing' ||
      progress.phase === 'running';

    pipelineBusy = busy;
    fab.classList.toggle('busy', busy);
    fab.classList.toggle('done', progress.phase === 'done');
    fab.classList.toggle('error', progress.phase === 'error');
    fab.classList.toggle('expanded', progress.phase !== 'idle');
    fab.disabled = busy;

    if (progress.phase === 'idle') {
      statusEl.hidden = true;
      statusEl.textContent = '';
      iconEl.hidden = false;
      fab.title = 'Run Oak: Fetch → Analyze → Fill';
      return;
    }

    statusEl.hidden = false;
    iconEl.hidden = false;
    statusEl.textContent = progress.message;
    fab.title = progress.error
      ? progress.error
      : progress.stepLabel
        ? `${progress.message} — ${progress.stepLabel}`
        : progress.message;
  }

  fab.addEventListener('click', () => {
    if (pipelineBusy) return;
    applyProgress({ phase: 'fetching', message: 'Starting…' });
    chrome.runtime.sendMessage({ type: MSG.START_PIPELINE }, (res) => {
      if (chrome.runtime.lastError) {
        applyProgress({
          phase: 'error',
          message: 'Failed to start',
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      if (res?.error) {
        applyProgress({
          phase: 'error',
          message: 'Failed to start',
          error: String(res.error),
        });
      }
    });
  });

  closeBtn.addEventListener('click', () => setOpen(false));

  window.addEventListener('message', (e) => {
    if (e.data?.type === MSG.SIDEBAR_CLOSE) setOpen(false);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG.TOGGLE_SIDEBAR) {
      setOpen(!open);
      return;
    }
    if (message.type === MSG.PIPELINE_PROGRESS && message.progress) {
      applyProgress(message.progress as PipelineProgress);
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
    min-width: 52px;
    height: 52px;
    padding: 0 14px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    pointer-events: auto;
    background: linear-gradient(135deg, #2f6f4e, #1f4d36);
    box-shadow: 0 4px 20px rgba(31, 77, 54, 0.4), 0 2px 8px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s, width 0.2s, background 0.2s;
    z-index: 2147483647;
    color: #f3faf5;
  }

  .oak-fab:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow: 0 6px 28px rgba(31, 77, 54, 0.5);
  }

  .oak-fab:disabled {
    cursor: default;
    opacity: 0.95;
  }

  .oak-fab.expanded {
    padding-right: 16px;
  }

  .oak-fab.busy {
    background: linear-gradient(135deg, #3d7a56, #285c40);
  }

  .oak-fab.busy .oak-fab-icon {
    animation: oak-spin 1.2s linear infinite;
  }

  .oak-fab.done {
    background: linear-gradient(135deg, #2f6f4e, #245a3d);
  }

  .oak-fab.error {
    background: linear-gradient(135deg, #8b3a3a, #6b2a2a);
  }

  .oak-fab-icon { font-size: 22px; line-height: 1; flex-shrink: 0; }

  .oak-fab-status {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes oak-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

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
