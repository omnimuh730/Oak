import { io, Socket } from 'socket.io-client';
import { evalScriptInTab } from './eval-utils';
import {
  DEFAULT_SERVER,
  MSG,
  type DomTreePayload,
  type ExecuteActionsPayload,
  type EvalScriptPayload,
  type GetContentPayload,
  type HighlightPayload,
} from './types';

let socket: Socket | null = null;
let socketConnected = false;

const KEEP_ALIVE_ALARM = 'oak-socket-keep-alive';
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM && !socketConnected && socket) {
    socket.connect();
  }
});

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
    const { tabId, nodeId } = payload;
    if (!tabId || nodeId == null) return;

    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.HIGHLIGHT, nodeId });
    } catch (err) {
      console.warn('[Oak] highlight failed:', err);
    }
  });

  socket.on('dom:get-content', (payload: GetContentPayload, ack?: (res: unknown) => void) => {
    const { tabId, nodeId, contentType } = payload;
    if (!tabId || nodeId == null || !contentType) {
      ack?.({ error: 'Invalid payload' });
      return;
    }

    chrome.tabs.sendMessage(
      tabId,
      { type: MSG.GET_CONTENT, nodeId, contentType },
      (res) => {
        if (chrome.runtime.lastError) {
          ack?.({ error: chrome.runtime.lastError.message });
          return;
        }
        ack?.(res);
      },
    );
  });

  socket.on('dom:execute-actions', (payload: ExecuteActionsPayload, ack?: (res: unknown) => void) => {
    const { tabId, nodeId, steps } = payload;
    if (!tabId || nodeId == null || !steps?.length) {
      ack?.({ error: 'Invalid payload' });
      return;
    }

    chrome.tabs.sendMessage(
      tabId,
      { type: MSG.EXECUTE_ACTIONS, nodeId, steps },
      (res) => {
        if (chrome.runtime.lastError) {
          ack?.({ error: chrome.runtime.lastError.message });
          return;
        }
        ack?.(res);
      },
    );
  });

  socket.on('dom:eval-script', async (payload: EvalScriptPayload, ack?: (res: unknown) => void) => {
    const { tabId, url, code } = payload;
    if (!tabId || !url || !code?.trim()) {
      ack?.({ error: 'Missing tabId, url, or code' });
      return;
    }

    try {
      const result = await evalScriptInTab(tabId, url, code, payload.frameId);
      ack?.({ ok: true, result });
    } catch (err) {
      ack?.({ error: err instanceof Error ? err.message : String(err) });
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
