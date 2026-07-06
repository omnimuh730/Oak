import { MSG } from '../types';
import { serializeDom } from './dom-serializer';
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
});
