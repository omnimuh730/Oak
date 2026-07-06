import { MSG } from './types';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_SIDEBAR });
  } catch {
    // Content script not loaded yet (e.g. page opened before extension install).
    // Reload the tab to inject the content script.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG.FETCH_DOM) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: MSG.FETCH_DOM });
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: String(err) });
      }
    });
    return true;
  }
});
