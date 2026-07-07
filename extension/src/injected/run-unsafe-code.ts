/**
 * Injected via chrome.scripting.executeScript (MAIN or isolated world).
 * Isolated world bypasses page CSP; MAIN allows page-global access when CSP permits.
 * Must stay self-contained — no imports.
 */
export function runUnsafeCode(userCode: string): Promise<string> {
  const exec = new Function(
    'userCode',
    `
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
          } catch (e) {}
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
        } catch (e) {
          return queryDeep(document, '#' + id);
        }
      },
      byOakId(nodeId) {
        return queryDeep(document, '[data-oak-id="' + nodeId + '"]');
      },
      setValue(el, value) {
        if (!el) throw new Error('Element not found');
        el.focus();

        const proto =
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
          el instanceof HTMLInputElement ? HTMLInputElement.prototype :
          null;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, value);
        } else if ('value' in el) {
          el.value = value;
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
        } catch (e) {}

        if (typeof jQuery !== 'undefined' && jQuery.fn && el.id) {
          try { jQuery('#' + el.id).val(value).trigger('input').trigger('change'); } catch (e) {}
        } else if (typeof jQuery !== 'undefined' && jQuery.fn) {
          try { jQuery(el).val(value).trigger('input').trigger('change'); } catch (e) {}
        }

        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return el;
      },
      waitFor(test, timeoutMs) {
        const limit = timeoutMs == null ? 10000 : timeoutMs;
        return new Promise(function(resolve, reject) {
          const deadline = Date.now() + limit;
          const check = function() {
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
            } catch (e) {}
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

    const runner = new Function('return (async () => { ' + userCode + ' })();');
    return runner().then(formatEvalResult).catch(function(err) {
      throw err;
    });
  `,
  ) as (code: string) => Promise<string>;

  return exec(userCode);
}
