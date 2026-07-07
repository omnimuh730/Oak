/**
 * Injected via chrome.scripting.executeScript (MAIN or isolated world).
 * Strict CSP pages can still block dynamic code; eval-utils falls back to debugger evaluation.
 * Must stay self-contained — no imports.
 */
export function runUnsafeCode(userCode: string): Promise<string> {
  function queryDeep(root: Document | Element | ShadowRoot, selector: string): Element | null {
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
          const doc = (child as HTMLIFrameElement).contentDocument;
          if (doc) {
            const found = queryDeep(doc, selector);
            if (found) return found;
          }
        } catch {
          // cross-origin iframe
        }
      }
    }
    return null;
  }

  const __oak = {
    queryDeep,
    byId(id: string): Element | null {
      if (!id) return null;
      try {
        return queryDeep(document, '#' + CSS.escape(id));
      } catch {
        return queryDeep(document, '#' + id);
      }
    },
    byOakId(nodeId: number | string): Element | null {
      return queryDeep(document, '[data-oak-id="' + nodeId + '"]');
    },
    setValue(el: Element | null, value: unknown): Element {
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
        (el as HTMLInputElement | HTMLTextAreaElement).value = String(value);
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
      } catch {
        // InputEvent unsupported in some contexts
      }

      const win = window as typeof window & {
        jQuery?: (sel: string | Element) => {
          val: (v: unknown) => { trigger: (eventName: string) => unknown };
        };
      };
      if (win.jQuery && 'fn' in win.jQuery && (win.jQuery as unknown as { fn?: unknown }).fn && el.id) {
        try { win.jQuery('#' + el.id).val(value).trigger('input'); } catch {
          // Optional jQuery compatibility
        }
        try { win.jQuery('#' + el.id).val(value).trigger('change'); } catch {
          // Optional jQuery compatibility
        }
      } else if (win.jQuery && 'fn' in win.jQuery && (win.jQuery as unknown as { fn?: unknown }).fn) {
        try { win.jQuery(el).val(value).trigger('input'); } catch {
          // Optional jQuery compatibility
        }
        try { win.jQuery(el).val(value).trigger('change'); } catch {
          // Optional jQuery compatibility
        }
      }

      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return el;
    },
    waitFor(test: string | (() => unknown), timeoutMs?: number): Promise<unknown> {
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
          } catch {
            // Keep polling until timeout.
          }
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

  function formatEvalResult(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';

    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return value.toString();
    if (value instanceof Error) return value.stack || value.message;
    if (value instanceof Date) return value.toISOString();

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  const runner = new Function('__oak', 'return (async () => { ' + userCode + ' })();') as (
    helper: typeof __oak,
  ) => Promise<unknown>;

  return runner(__oak).then(formatEvalResult);
}
