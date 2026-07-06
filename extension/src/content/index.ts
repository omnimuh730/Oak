import { MSG } from '../types';
import { serializeDom, getDirectText } from './dom-serializer';
import { resolveElementByPath } from './element-resolver';
import { clearHighlight, highlightElement } from './highlighter';
import { injectOakUI } from './inject-ui';

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