import { io, Socket } from 'socket.io-client';
import { DEFAULT_SERVER, MSG, type DomTreePayload, type HighlightPayload } from './types';

let socket: Socket | null = null;
let socketConnected = false;

function connectSocket(serverUrl: string) {
  socket?.disconnect();
  socket = io(serverUrl, {
    query: { type: 'extension', name: 'Oak Extension' },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    socketConnected = true;
  });

  socket.on('disconnect', () => {
    socketConnected = false;
  });

  socket.on('dom:highlight', async (payload: HighlightPayload) => {
    const { tabId, path } = payload;
    if (!tabId || !path) return;

    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.HIGHLIGHT, path });
    } catch (err) {
      console.warn('[Oak] highlight failed:', err);
    }
  });
}

chrome.storage.local.get(['serverUrl'], (result) => {
  connectSocket(result.serverUrl || DEFAULT_SERVER);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl?.newValue) {
    connectSocket(changes.serverUrl.newValue as string);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_SIDEBAR });
  } catch {
    // Content script not loaded yet — reload the tab to inject it.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MSG.SOCKET_STATUS) {
    sendResponse({ connected: socketConnected });
    return true;
  }

  if (message.type === MSG.FETCH_DOM || message.type === MSG.FETCH_AND_EMIT_DOM) {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: MSG.FETCH_DOM });

        if (result?.error) {
          sendResponse({ error: result.error });
          return;
        }

        if (!result?.tree) {
          sendResponse({ error: 'No DOM tree returned from page' });
          return;
        }

        const payload: DomTreePayload = { ...result, tabId: tab.id };

        if (message.type === MSG.FETCH_AND_EMIT_DOM) {
          socket?.emit('dom:tree', payload);
        }

        sendResponse(payload);
      } catch (err) {
        sendResponse({ error: String(err) });
      }
    });
    return true;
  }
});
