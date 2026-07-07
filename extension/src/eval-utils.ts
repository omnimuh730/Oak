import { runUnsafeCode } from './injected/run-unsafe-code';

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

function isCspEvalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /EvalError|Content Security Policy|unsafe-eval|Refused to evaluate/i.test(msg);
}

function isDebuggerUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /another debugger|debugger is not attached|debugger permission|cannot access/i.test(msg);
}

function formatDebuggerUnavailableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `Strict CSP pages require Oak's debugger eval path. Close Chrome DevTools for this tab, then run Script Eval again. (${msg})`,
  );
}

type EvalWorld = 'MAIN' | 'ISOLATED';

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

async function runEvalInWorld(
  tabId: number,
  frameId: number,
  code: string,
  world: EvalWorld,
): Promise<string> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    ...(world === 'MAIN' ? { world: 'MAIN' as const } : {}),
    func: runUnsafeCode,
    args: [code],
  });

  if (injection?.result === undefined) {
    throw new Error('Script eval returned no result');
  }

  return injection.result;
}

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

function buildDebuggerExpression(userCode: string): string {
  return `
(async () => {
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

  const __oak = {
    queryDeep,
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
    if (value === undefined) return 'undefined';
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

function shouldUseDebuggerFirst(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'ashbyhq.com' || hostname.endsWith('.ashbyhq.com');
  } catch {
    return false;
  }
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
): Promise<string> {
  await attachDebugger(tabId);
  try {
    const contextId = await createDebuggerWorld(tabId, frameUrl);
    const expression = buildDebuggerExpression(code);
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
): Promise<string> {
  const targetFrameId = await findFrameId(tabId, url, frameId, oakNodeId);

  if (shouldUseDebuggerFirst(url)) {
    try {
      return await runEvalWithDebugger(tabId, code, url);
    } catch (err) {
      if (isDebuggerUnavailableError(err)) {
        throw formatDebuggerUnavailableError(err);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  try {
    return await runEvalInWorld(tabId, targetFrameId, code, 'ISOLATED');
  } catch (isolatedErr) {
    if (isCspEvalError(isolatedErr)) {
      return runEvalWithDebugger(tabId, code, url);
    }

    try {
      return await runEvalInWorld(tabId, targetFrameId, code, 'MAIN');
    } catch (mainErr) {
      if (isCspEvalError(mainErr)) {
        return runEvalWithDebugger(tabId, code, url);
      }
      throw mainErr instanceof Error ? mainErr : new Error(String(mainErr));
    }
  }
}
