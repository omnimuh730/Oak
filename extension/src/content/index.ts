import { MSG } from '../types';
import { serializeDom } from './dom-serializer';
import { resolveElementByPath } from './element-resolver';
import { clearHighlight, highlightElement } from './highlighter';
import { injectOakUI } from './inject-ui';

function getDirectText(el: Element): string | undefined {
  const parts: string[] = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join(' ').slice(0, 120);
}

injectOakUI();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG.FETCH_DOM) {
    try {
      const tree = serializeDom();
      sendResponse({
        url: window.location.href,
        title: document.title,
        tree,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.HIGHLIGHT) {
    try {
      const el = resolveElementByPath(message.path as number[]);
      if (el) {
        const text = getDirectText(el);
        highlightElement(el, text);
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'Element not found' });
      }
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.CLEAR_HIGHLIGHT) {
    clearHighlight();
    sendResponse({ ok: true });
    return true;
  }
});
