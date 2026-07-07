/**
 * Injected into the page MAIN world via chrome.scripting.executeScript.
 * Must stay self-contained — no imports.
 */
export function runUnsafeCode(userCode: string): Promise<string> {
  const exec = new Function(
    'userCode',
    `
    const __oak = {
      byId(id) {
        return document.getElementById(id);
      },
      byOakId(nodeId) {
        return document.querySelector('[data-oak-id="' + nodeId + '"]');
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
        return el;
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
