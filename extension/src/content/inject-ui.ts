import type { PipelineProgress } from '../../../shared/pipeline-types';
import { MSG } from '../types';
import { shouldMountOakUi } from './form-frame';

const HOST_ID = 'oak-extension-host';

let persistObserver: MutationObserver | null = null;

function shouldShowUI(): boolean {
  return shouldMountOakUi();
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

  const iconUrl = chrome.runtime.getURL('public/icon-48.png');

  const sidebar = document.createElement('div');
  sidebar.className = 'oak-sidebar';
  sidebar.innerHTML = `
    <div class="oak-sidebar-header">
      <span class="oak-logo"><img src="${iconUrl}" alt="" width="22" height="22" /> Oak</span>
      <button class="oak-close" title="Close">✕</button>
    </div>
    <iframe class="oak-sidebar-frame" src="${chrome.runtime.getURL('sidebar.html')}" allow="clipboard-read; clipboard-write"></iframe>
  `;
  shadow.appendChild(sidebar);

  const closeBtn = sidebar.querySelector('.oak-close') as HTMLButtonElement;
  const frame = sidebar.querySelector('.oak-sidebar-frame') as HTMLIFrameElement;

  let open = false;
  let pipelineBusy = false;

  function setOpen(value: boolean) {
    open = value;
    sidebar.classList.toggle('open', open);
  }

  function postToSidebar(message: unknown) {
    frame.contentWindow?.postMessage(message, '*');
  }

  function applyProgress(progress: PipelineProgress) {
    pipelineBusy =
      progress.phase === 'fetching' ||
      progress.phase === 'analyzing' ||
      progress.phase === 'running';
    postToSidebar({ type: MSG.PIPELINE_PROGRESS, progress });
  }

  function startPipeline() {
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
        const err = String(res.error);
        if (/sign in/i.test(err)) {
          setOpen(true);
          applyProgress({ phase: 'idle', message: 'Sign in to Athens to run Oak' });
          return;
        }
        applyProgress({
          phase: 'error',
          message: 'Failed to start',
          error: err,
        });
      }
    });
  }

  closeBtn.addEventListener('click', () => setOpen(false));

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.type === MSG.SIDEBAR_CLOSE) setOpen(false);
    if (e.data?.type === MSG.START_PIPELINE) {
      if (pipelineBusy) return;
      setOpen(true);
      startPipeline();
    }
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

  persistObserver.observe(document.documentElement, { childList: true, subtree: true });
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: #e8eaef;
  }

  .oak-logo img {
    border-radius: 5px;
    object-fit: cover;
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
