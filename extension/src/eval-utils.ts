import type { AttachedFile } from './types';

export function urlsMatch(frameUrl: string, expectedUrl: string): boolean {
  if (frameUrl === expectedUrl) return true;

  try {
    const current = new URL(frameUrl);
    const target = new URL(expectedUrl);
    return current.origin === target.origin && current.pathname === target.pathname;
  } catch {
    return false;
  }
}

function isDebuggerUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /another debugger|debugger is not attached|debugger permission|cannot access/i.test(msg);
}

function formatDebuggerUnavailableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `Script Eval uses Oak's debugger eval path to avoid page CSP. Close Chrome DevTools for this tab, then run Script Eval again. (${msg})`,
  );
}

type DebuggerEvalResponse = {
  result?: {
    type?: string;
    value?: unknown;
    unserializableValue?: string;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
};

type DebuggerCreateWorldResponse = {
  executionContextId?: number;
};

type DebuggerFrameTree = {
  frame?: { id?: string; url?: string };
  childFrames?: DebuggerFrameTree[];
};

function debuggerTarget(tabId: number): chrome.debugger.Debuggee {
  return { tabId };
}

function attachDebugger(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggerTarget(tabId), '1.3', () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggerTarget(tabId), () => {
      resolve();
    });
  });
}

function sendDebuggerCommand<T>(
  tabId: number,
  method: string,
  commandParams?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggerTarget(tabId), method, commandParams, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result as T);
    });
  });
}

function formatDebuggerException(response: DebuggerEvalResponse): Error {
  const details = response.exceptionDetails;
  const message =
    details?.exception?.description ??
    (details?.exception?.value != null ? String(details.exception.value) : undefined) ??
    details?.text ??
    'Debugger eval failed';
  return new Error(message);
}

function formatDebuggerResult(response: DebuggerEvalResponse): string {
  if (response.exceptionDetails) {
    throw formatDebuggerException(response);
  }

  const remote = response.result;
  if (!remote) return 'undefined';
  if (remote.value !== undefined) return String(remote.value);
  if (remote.unserializableValue !== undefined) return remote.unserializableValue;
  if (remote.description !== undefined) return remote.description;
  return remote.type ?? 'undefined';
}

function buildOakFilesMap(files?: AttachedFile[]): Record<string, { name: string; mimeType: string; base64: string }> {
  const map: Record<string, { name: string; mimeType: string; base64: string }> = {};
  if (!files?.length) return map;
  for (const file of files) {
    if (!file.key) continue;
    map[file.key] = { name: file.name, mimeType: file.mimeType, base64: file.base64 };
  }
  return map;
}

function buildDebuggerExpression(userCode: string, files?: AttachedFile[]): string {
  const oakFilesJson = JSON.stringify(buildOakFilesMap(files));
  return `
(async () => {
  const __oakAttachedFiles = ${oakFilesJson};
  window.OAK_ATTACHED_FILES = __oakAttachedFiles;
  window.attachDroppedFile = function(input, fileKey) {
    const meta = __oakAttachedFiles[fileKey];
    if (!meta) throw new Error('Unknown file key: ' + fileKey);
    if (!input || input.type !== 'file') throw new Error('Not a file input');
    const binary = atob(meta.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], meta.name, { type: meta.mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input;
  };

  function queryDeep(root, selector) {
    if (root && 'querySelector' in root) {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    }

    const nodes = root && 'querySelectorAll' in root ? root.querySelectorAll('*') : [];
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (child.shadowRoot) {
        const found = queryDeep(child.shadowRoot, selector);
        if (found) return found;
      }
      if (child.tagName === 'IFRAME') {
        try {
          const doc = child.contentDocument;
          if (doc) {
            const found = queryDeep(doc, selector);
            if (found) return found;
          }
        } catch {}
      }
    }
    return null;
  }

  function queryDeepAll(root, selector, results) {
    const out = results || [];
    if (root && 'querySelectorAll' in root) {
      try {
        const direct = root.querySelectorAll(selector);
        for (let i = 0; i < direct.length; i++) out.push(direct[i]);
      } catch {}
    }

    const nodes = root && 'querySelectorAll' in root ? root.querySelectorAll('*') : [];
    for (let i = 0; i < nodes.length; i++) {
      const child = nodes[i];
      if (child.shadowRoot) queryDeepAll(child.shadowRoot, selector, out);
      if (child.tagName === 'IFRAME') {
        try {
          const doc = child.contentDocument;
          if (doc) queryDeepAll(doc, selector, out);
        } catch {}
      }
    }
    return Array.from(new Set(out));
  }

  function textOf(el) {
    return (el && (el.textContent || el.getAttribute?.('aria-label') || el.getAttribute?.('title')) || '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function textMatches(actual, expected) {
    const a = String(actual || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const e = String(expected || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    return Boolean(a && e && (a === e || a.startsWith(e) || a.includes(e)));
  }

  function dispatchChange(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  function clickLikeUser(el) {
    if (!el) return null;
    if (el instanceof HTMLElement) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
      try { el.focus(); } catch {}
    }
    const mouseInit = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        const evt = type.startsWith('pointer')
          ? new PointerEvent(type, mouseInit)
          : new MouseEvent(type, mouseInit);
        el.dispatchEvent(evt);
      } catch {
        try { el.dispatchEvent(new MouseEvent(type, mouseInit)); } catch {}
      }
    }
    try { el.click?.(); } catch {}
    return el;
  }

  function setSelectByText(select, text) {
    if (!select || select.tagName !== 'SELECT') return false;
    const options = Array.from(select.options || []);
    const option =
      options.find((opt) => textOf(opt).toLowerCase() === String(text).trim().toLowerCase()) ||
      options.find((opt) => textMatches(textOf(opt), text)) ||
      options.find((opt) => textMatches(opt.value, text));
    if (!option) return false;
    select.value = option.value;
    option.selected = true;
    dispatchChange(select);
    return true;
  }

  async function clickIcimsDropdownOption(target, optionText, timeoutMs) {
    const el = typeof target === 'number' ? queryDeep(document, '[data-oak-id="' + target + '"]') : target;
    if (!el) return false;

    const baseId =
      el.tagName === 'SELECT' && el.id ? el.id :
        el.id && el.id.endsWith('_icimsDropdown') ? el.id.replace(/_icimsDropdown$/, '') :
          el.getAttribute?.('aria-controls')?.replace(/_dropdown-results$/, '') ||
          el.closest?.('.dropdown-container')?.id?.replace(/_icimsDropdown_ctnr$/, '') ||
          '';

    const nativeSelect = baseId ? queryDeep(document, '#' + CSS.escape(baseId)) : null;
    if (nativeSelect && setSelectByText(nativeSelect, optionText)) return true;

    const trigger =
      baseId ? queryDeep(document, '#' + CSS.escape(baseId + '_icimsDropdown')) : null;
    const container =
      baseId ? queryDeep(document, '#' + CSS.escape(baseId + '_icimsDropdown_ctnr')) : el.closest?.('.dropdown-container');

    clickLikeUser(trigger || el);

    const root = container || document;
    const waitLimit = timeoutMs == null ? 5000 : timeoutMs;
    const option = await new Promise((resolve) => {
      const deadline = Date.now() + waitLimit;
      const check = () => {
        const options = queryDeepAll(root, '[role="option"], .dropdown-result, li');
        const exact = options.find((item) => textOf(item).toLowerCase() === String(optionText).trim().toLowerCase());
        const loose = exact || options.find((item) => textMatches(textOf(item), optionText));
        if (loose) {
          resolve(loose);
          return;
        }
        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });

    if (!option) return false;
    clickLikeUser(option);
    if (nativeSelect) dispatchChange(nativeSelect);
    return true;
  }

  const __oak = {
    queryDeep,
    queryDeepAll(root, selector) {
      return queryDeepAll(root || document, selector);
    },
    byId(id) {
      if (!id) return null;
      try {
        return queryDeep(document, '#' + CSS.escape(id));
      } catch {
        return queryDeep(document, '#' + id);
      }
    },
    byOakId(nodeId) {
      return queryDeep(document, '[data-oak-id="' + nodeId + '"]');
    },
    click(el) {
      return clickLikeUser(el);
    },
    async clickIcimsDropdownOption(target, optionText, timeoutMs) {
      return clickIcimsDropdownOption(target, optionText, timeoutMs);
    },
    async selectByText(el, text, timeoutMs) {
      if (!el) return false;
      if (el.tagName === 'SELECT') {
        if (setSelectByText(el, text)) return true;
        if (el.getAttribute('icimsdropdown-enabled') === '1' || el.classList?.contains('dropdown-hide')) {
          return clickIcimsDropdownOption(el, text, timeoutMs);
        }
        return false;
      }
      if (
        el.getAttribute?.('role') === 'combobox' ||
        el.classList?.contains('dropdown-select') ||
        el.classList?.contains('dropdown-search') ||
        el.closest?.('.dropdown-container')
      ) {
        return clickIcimsDropdownOption(el, text, timeoutMs);
      }
      return false;
    },
    setValue(el, value) {
      if (!el) throw new Error('Element not found');
      if (el instanceof HTMLElement) el.focus();

      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
          el instanceof HTMLInputElement ? HTMLInputElement.prototype :
            null;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, value);
      } else if ('value' in el) {
        el.value = String(value);
      } else {
        throw new Error('Element does not support value');
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: String(value),
        }));
      } catch {}

      if (typeof jQuery !== 'undefined' && jQuery.fn && el.id) {
        try { jQuery('#' + el.id).val(value).trigger('input'); } catch {}
        try { jQuery('#' + el.id).val(value).trigger('change'); } catch {}
      } else if (typeof jQuery !== 'undefined' && jQuery.fn) {
        try { jQuery(el).val(value).trigger('input'); } catch {}
        try { jQuery(el).val(value).trigger('change'); } catch {}
      }

      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return el;
    },
    waitFor(test, timeoutMs) {
      const limit = timeoutMs == null ? 10000 : timeoutMs;
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + limit;
        const check = () => {
          try {
            const result = typeof test === 'string'
              ? queryDeep(document, test)
              : typeof test === 'function'
                ? test()
                : null;
            if (result) {
              resolve(result);
              return;
            }
          } catch {}
          if (Date.now() > deadline) {
            reject(new Error('waitFor timed out'));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    },
  };

  function formatEvalResult(value) {
    if (value === undefined) {
      return JSON.stringify({ ok: true, result: 'Script completed without return value' }, null, 2);
    }
    if (value === null) return 'null';

    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
    if (type === 'symbol') return value.toString();
    if (type === 'function') return value.toString();
    if (value instanceof Error) return value.stack || value.message;
    if (value instanceof Date) return value.toISOString();

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  const __oakRun = async () => {
${userCode}
  };

  return formatEvalResult(await __oakRun());
})()
`;
}

async function createDebuggerWorld(
  tabId: number,
  frameUrl: string,
): Promise<number | undefined> {
  try {
    const frames = await sendDebuggerCommand<{
      frameTree?: DebuggerFrameTree;
    }>(tabId, 'Page.getFrameTree');

    const stack = frames.frameTree ? [frames.frameTree] : [];
    while (stack.length) {
      const current = stack.shift();
      const frame = current?.frame;
      if (frame?.id && frame.url && urlsMatch(frame.url, frameUrl)) {
        const world = await sendDebuggerCommand<DebuggerCreateWorldResponse>(
          tabId,
          'Page.createIsolatedWorld',
          {
            frameId: frame.id,
            worldName: 'oak-script-eval',
            grantUniveralAccess: false,
          },
        );
        return world.executionContextId;
      }

      const childFrames = current?.childFrames;
      if (Array.isArray(childFrames)) {
        stack.push(...childFrames);
      }
    }
  } catch {
    // Runtime.evaluate can still run in the default context.
  }

  return undefined;
}

async function runEvalWithDebugger(
  tabId: number,
  code: string,
  frameUrl: string,
  files?: AttachedFile[],
): Promise<string> {
  await attachDebugger(tabId);
  try {
    const contextId = await createDebuggerWorld(tabId, frameUrl);
    const expression = buildDebuggerExpression(code, files);
    const response = await sendDebuggerCommand<DebuggerEvalResponse>(tabId, 'Runtime.evaluate', {
      expression,
      ...(contextId != null ? { contextId } : {}),
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      allowUnsafeEvalBlockedByCSP: true,
    });
    return formatDebuggerResult(response);
  } finally {
    await detachDebugger(tabId);
  }
}

async function frameContainsOakId(
  tabId: number,
  frameId: number,
  oakNodeId: number,
): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (nodeId: number) => {
        function queryDeep(root: Document | Element | ShadowRoot, sel: string): Element | null {
          if ('querySelector' in root) {
            const direct = root.querySelector(sel);
            if (direct) return direct;
          }
          const nodes = 'querySelectorAll' in root ? root.querySelectorAll('*') : [];
          for (const child of Array.from(nodes)) {
            if (child.shadowRoot) {
              const found = queryDeep(child.shadowRoot, sel);
              if (found) return found;
            }
            if (child.tagName === 'IFRAME') {
              try {
                const doc = (child as HTMLIFrameElement).contentDocument;
                if (doc) {
                  const found = queryDeep(doc, `[data-oak-id="${nodeId}"]`);
                  if (found) return found;
                }
              } catch {
                // cross-origin iframe
              }
            }
          }
          return null;
        }
        return queryDeep(document, `[data-oak-id="${nodeId}"]`) != null;
      },
      args: [oakNodeId],
    });
    return Boolean(injection?.result);
  } catch {
    return false;
  }
}

async function findFrameForOakId(
  tabId: number,
  oakNodeId: number,
  frames: chrome.webNavigation.GetAllFrameResultDetails[],
): Promise<number | null> {
  for (const frame of frames) {
    if (await frameContainsOakId(tabId, frame.frameId, oakNodeId)) {
      return frame.frameId;
    }
  }
  return null;
}

export async function findFrameId(
  tabId: number,
  expectedUrl: string,
  preferredFrameId?: number,
  oakNodeId?: number,
): Promise<number> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length) throw new Error('No frames found in tab');

  if (oakNodeId != null) {
    const frameWithNode = await findFrameForOakId(tabId, oakNodeId, frames);
    if (frameWithNode != null) return frameWithNode;
  }

  if (preferredFrameId != null) {
    const preferred = frames.find((f) => f.frameId === preferredFrameId);
    if (preferred) return preferred.frameId;
  }

  const top = frames.find((f) => f.parentFrameId === -1);
  if (top) return top.frameId;

  const exact = frames.find((f) => f.url === expectedUrl);
  if (exact) return exact.frameId;

  const loose = frames.find((f) => urlsMatch(f.url, expectedUrl));
  if (loose) return loose.frameId;

  return frames[0].frameId;
}

export async function evalScriptInTab(
  tabId: number,
  url: string,
  code: string,
  frameId?: number,
  oakNodeId?: number,
  files?: AttachedFile[],
): Promise<string> {
  try {
    const targetFrameId = await findFrameId(tabId, url, frameId, oakNodeId);
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const targetFrameUrl = frames?.find((f) => f.frameId === targetFrameId)?.url || url;
    return await runEvalWithDebugger(tabId, code, targetFrameUrl, files);
  } catch (err) {
    if (isDebuggerUnavailableError(err)) {
      throw formatDebuggerUnavailableError(err);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
