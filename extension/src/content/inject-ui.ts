import { formatDuration, formatUsd } from '../../../shared/ai-usage';
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

function sendRuntime<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      reject(err);
    }
  });
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

  const fab = document.createElement('button');
  fab.className = 'oak-fab';
  fab.title = 'Run Oak: Fetch → Analyze → Fill';
  fab.type = 'button';
  fab.innerHTML = `
    <img class="oak-fab-icon" src="${iconUrl}" alt="Oak" width="28" height="28" />
    <span class="oak-fab-status" hidden></span>
  `;
  shadow.appendChild(fab);

  const accountBtn = document.createElement('button');
  accountBtn.className = 'oak-account-btn';
  accountBtn.type = 'button';
  accountBtn.title = 'Account';
  accountBtn.hidden = true;
  accountBtn.textContent = 'Account';
  shadow.appendChild(accountBtn);

  const modal = document.createElement('div');
  modal.className = 'oak-signin';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="oak-signin-card" role="dialog" aria-label="Athens account">
      <div class="oak-signin-header">
        <img src="${iconUrl}" alt="" width="28" height="28" />
        <div>
          <strong class="oak-modal-title">Sign in to Athens</strong>
          <p class="oak-modal-subtitle">Use your Athens account to run Oak</p>
        </div>
        <button type="button" class="oak-signin-close" aria-label="Close">✕</button>
      </div>
      <div class="oak-signin-form">
        <label class="oak-field">
          <span>Username</span>
          <input class="oak-signin-name" autocomplete="username" placeholder="Athens username" />
        </label>
        <label class="oak-field">
          <span>Password</span>
          <input class="oak-signin-password" type="password" autocomplete="current-password" placeholder="Password" />
        </label>
      </div>
      <div class="oak-account-panel" hidden>
        <p class="oak-account-name"></p>
        <p class="oak-account-hint">Signed in with your Athens account</p>
      </div>
      <p class="oak-signin-error" hidden></p>
      <div class="oak-signin-actions">
        <button type="button" class="oak-signin-submit">Sign in</button>
        <button type="button" class="oak-signout-btn" hidden>Sign out</button>
      </div>
    </div>
  `;
  shadow.appendChild(modal);

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
  const statusEl = fab.querySelector('.oak-fab-status') as HTMLSpanElement;
  const iconEl = fab.querySelector('.oak-fab-icon') as HTMLImageElement;
  const nameInput = modal.querySelector('.oak-signin-name') as HTMLInputElement;
  const passwordInput = modal.querySelector('.oak-signin-password') as HTMLInputElement;
  const errorEl = modal.querySelector('.oak-signin-error') as HTMLParagraphElement;
  const submitBtn = modal.querySelector('.oak-signin-submit') as HTMLButtonElement;
  const signOutBtn = modal.querySelector('.oak-signout-btn') as HTMLButtonElement;
  const modalCloseBtn = modal.querySelector('.oak-signin-close') as HTMLButtonElement;
  const modalTitle = modal.querySelector('.oak-modal-title') as HTMLElement;
  const modalSubtitle = modal.querySelector('.oak-modal-subtitle') as HTMLElement;
  const signInForm = modal.querySelector('.oak-signin-form') as HTMLElement;
  const accountPanel = modal.querySelector('.oak-account-panel') as HTMLElement;
  const accountNameEl = modal.querySelector('.oak-account-name') as HTMLElement;

  let open = false;
  let pipelineBusy = false;
  let signedIn = false;
  let displayName = '';
  let startAfterSignIn = false;

  function setOpen(value: boolean) {
    open = value;
    sidebar.classList.toggle('open', open);
  }

  function setModalMode(mode: 'signin' | 'account') {
    const isAccount = mode === 'account';
    signInForm.hidden = isAccount;
    accountPanel.hidden = !isAccount;
    submitBtn.hidden = isAccount;
    signOutBtn.hidden = !isAccount;
    modalTitle.textContent = isAccount ? 'Athens account' : 'Sign in to Athens';
    modalSubtitle.textContent = isAccount
      ? 'Manage your Oak session'
      : 'Use your Athens account to run Oak';
    accountNameEl.textContent = displayName || 'Signed in';
  }

  function setSignInOpen(value: boolean) {
    modal.hidden = !value;
    if (value) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      passwordInput.value = '';
      setModalMode(signedIn ? 'account' : 'signin');
      if (!signedIn) queueMicrotask(() => nameInput.focus());
    }
  }

  function refreshAuthBadge() {
    fab.classList.toggle('needs-auth', !signedIn);
    accountBtn.hidden = !signedIn || pipelineBusy;
    fab.title = signedIn
      ? 'Run Oak: Fetch → Analyze → Fill'
      : 'Sign in to Athens to run Oak';
  }

  async function refreshAuthStatus() {
    try {
      const res = await sendRuntime<{
        signedIn?: boolean;
        session?: { displayName?: string; username?: string };
      }>({ type: MSG.AUTH_STATUS });
      signedIn = Boolean(res?.signedIn);
      displayName =
        res?.session?.displayName || res?.session?.username || '';
    } catch {
      signedIn = false;
      displayName = '';
    }
    refreshAuthBadge();
    if (!modal.hidden) setModalMode(signedIn ? 'account' : 'signin');
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
    accountBtn.hidden = !signedIn || busy;

    if (progress.phase === 'idle') {
      statusEl.hidden = true;
      statusEl.textContent = '';
      iconEl.hidden = false;
      refreshAuthBadge();
      return;
    }

    statusEl.hidden = false;
    iconEl.hidden = false;
    const visible =
      progress.phase === 'error' && progress.error
        ? truncateStatus(`${progress.message}: ${progress.error}`, 72)
        : progress.message;
    statusEl.textContent = visible;

    const detailParts = [
      progress.stepLabel ? `Step: ${progress.stepLabel}` : null,
      progress.durationMs != null ? `Time: ${formatDuration(progress.durationMs)}` : null,
      progress.usage
        ? `AI: ${formatUsd(progress.usage.costUsd)} · ${progress.usage.totalTokens || 0} tok`
        : null,
      progress.error ? `Error: ${progress.error}` : null,
    ].filter(Boolean);
    fab.title = detailParts.length ? detailParts.join('\n') : progress.message;
  }

  function truncateStatus(text: string, max: number): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
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
          signedIn = false;
          refreshAuthBadge();
          startAfterSignIn = true;
          setSignInOpen(true);
          applyProgress({ phase: 'idle', message: 'Idle' });
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

  async function submitSignIn() {
    const name = nameInput.value.trim();
    const password = passwordInput.value;
    if (!name || !password) {
      errorEl.hidden = false;
      errorEl.textContent = 'Enter username and password';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    errorEl.hidden = true;

    try {
      const res = await sendRuntime<{ ok?: boolean; error?: string }>({
        type: MSG.AUTH_SIGNIN,
        name,
        password,
      });
      if (!res?.ok) {
        throw new Error(res?.error || 'Sign in failed');
      }
      signedIn = true;
      refreshAuthBadge();
      setSignInOpen(false);
      if (startAfterSignIn) {
        startAfterSignIn = false;
        startPipeline();
      }
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  }

  async function submitSignOut() {
    signOutBtn.disabled = true;
    signOutBtn.textContent = 'Signing out…';
    errorEl.hidden = true;
    try {
      const res = await sendRuntime<{ ok?: boolean; error?: string }>({
        type: MSG.AUTH_SIGNOUT,
      });
      if (!res?.ok) throw new Error(res?.error || 'Sign out failed');
      signedIn = false;
      displayName = '';
      startAfterSignIn = false;
      refreshAuthBadge();
      setSignInOpen(false);
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      signOutBtn.disabled = false;
      signOutBtn.textContent = 'Sign out';
    }
  }

  fab.addEventListener('click', () => {
    if (pipelineBusy) return;
    if (!signedIn) {
      startAfterSignIn = true;
      setSignInOpen(true);
      return;
    }
    startPipeline();
  });

  accountBtn.addEventListener('click', () => {
    if (pipelineBusy) return;
    startAfterSignIn = false;
    setSignInOpen(true);
  });

  submitBtn.addEventListener('click', () => {
    void submitSignIn();
  });
  signOutBtn.addEventListener('click', () => {
    void submitSignOut();
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitSignIn();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });
  modalCloseBtn.addEventListener('click', () => {
    startAfterSignIn = false;
    setSignInOpen(false);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      startAfterSignIn = false;
      setSignInOpen(false);
    }
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
    if (message.type === MSG.AUTH_STATUS || message.type === 'oak:reconnect-socket') {
      void refreshAuthStatus();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.oakSession) void refreshAuthStatus();
  });

  void refreshAuthStatus();
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

  .oak-account-btn {
    position: fixed;
    bottom: 96px;
    left: 24px;
    pointer-events: auto;
    z-index: 2147483647;
    border: 1px solid rgba(120, 180, 140, 0.35);
    background: #142018;
    color: #eef7f1;
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  }

  .oak-account-btn:hover {
    background: #1a2a20;
  }

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

  .oak-fab.needs-auth {
    box-shadow: 0 4px 20px rgba(31, 77, 54, 0.35), 0 0 0 2px rgba(250, 204, 21, 0.55);
  }

  .oak-fab.busy {
    background: linear-gradient(135deg, #3d7a56, #285c40);
  }

  .oak-fab.busy .oak-fab-icon {
    animation: oak-pulse 1.1s ease-in-out infinite;
  }

  .oak-fab.done {
    background: linear-gradient(135deg, #2f6f4e, #245a3d);
  }

  .oak-fab.error {
    background: linear-gradient(135deg, #8b3a3a, #6b2a2a);
  }

  .oak-fab-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
    display: block;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .oak-fab-status {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes oak-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.72; transform: scale(0.94); }
  }

  .oak-signin {
    position: fixed;
    inset: 0;
    pointer-events: auto;
    z-index: 2147483647;
    background: rgba(8, 12, 10, 0.28);
  }

  .oak-signin-card {
    position: fixed;
    bottom: 100px;
    left: 24px;
    width: min(320px, calc(100vw - 48px));
    padding: 14px;
    border-radius: 16px;
    background: #142018;
    color: #eef7f1;
    border: 1px solid rgba(120, 180, 140, 0.28);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .oak-signin-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .oak-signin-header img {
    border-radius: 8px;
    flex-shrink: 0;
  }

  .oak-signin-header strong {
    display: block;
    font-size: 14px;
    font-weight: 650;
  }

  .oak-signin-header p {
    margin: 2px 0 0;
    font-size: 12px;
    color: #9eb5a6;
  }

  .oak-signin-close {
    margin-left: auto;
    background: transparent;
    border: none;
    color: #9eb5a6;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 6px;
  }

  .oak-signin-close:hover {
    background: rgba(255,255,255,0.06);
    color: #eef7f1;
  }

  .oak-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #9eb5a6;
  }

  .oak-field input {
    border: 1px solid rgba(120, 180, 140, 0.28);
    background: #0d1510;
    color: #eef7f1;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    outline: none;
  }

  .oak-field input:focus {
    border-color: rgba(120, 180, 140, 0.7);
  }

  .oak-signin-error {
    margin: 0;
    font-size: 12px;
    color: #fca5a5;
  }

  .oak-signin-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .oak-signin-submit,
  .oak-signout-btn {
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    color: #f3faf5;
    background: linear-gradient(135deg, #2f6f4e, #1f4d36);
  }

  .oak-signout-btn {
    background: #3a2222;
    border: 1px solid rgba(248, 113, 113, 0.35);
    color: #fecaca;
  }

  .oak-signin-submit:disabled,
  .oak-signout-btn:disabled {
    opacity: 0.7;
    cursor: default;
  }

  .oak-account-name {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
    color: #eef7f1;
  }

  .oak-account-hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: #9eb5a6;
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
