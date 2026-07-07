import { MSG } from '../types';
import { serializeDom, getDirectText } from './dom-serializer';
import { resolveElementByNodeId } from './element-resolver';
import { executeActions, getElementContent } from './action-runner';
import { clearHighlight, highlightElement } from './highlighter';
import { injectOakUI } from './inject-ui';

injectOakUI();

/** Only the top frame or Greenhouse embed frames own the page DOM for Oak. */
function isOakDomFrame(): boolean {
  if (window === window.top) return true;
  return location.hostname.endsWith('greenhouse.io');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.FETCH_DOM) {
    if (!isOakDomFrame()) return;

    try {
      const tree = serializeDom();
      sendResponse({
        url: window.location.href,
        title: document.title,
        tree,
        fetchedAt: new Date().toISOString(),
        frameId: sender.frameId,
      });
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.HIGHLIGHT) {
    if (!isOakDomFrame()) return;

    try {
      const el = resolveElementByNodeId(message.nodeId as number);
      if (el) {
        const text = getDirectText(el);
        highlightElement(el, text);
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'Element not found in DOM' });
      }
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.GET_CONTENT) {
    if (!isOakDomFrame()) return;

    try {
      const content = getElementContent(
        message.nodeId as number,
        message.contentType as 'innerHTML' | 'innerText',
      );
      sendResponse({ ok: true, content });
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.EXECUTE_ACTIONS) {
    if (!isOakDomFrame()) return;

    executeActions(message.nodeId as number, message.steps)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === MSG.CLEAR_HIGHLIGHT) {
    if (!isOakDomFrame()) return;

    clearHighlight();
    sendResponse({ ok: true });
    return true;
  }
});
