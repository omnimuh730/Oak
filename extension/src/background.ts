import { io, Socket } from 'socket.io-client';
import type { PipelineProgress } from '../../shared/pipeline-types';
import {
  authHeaders,
  getAccessToken,
  getAthensApiUrl,
  getOakSession,
  oakSignIn,
  oakSignOut,
  OAK_SOCKET_PATH,
} from './auth/oak-auth';
import { runFabPipeline } from './pipeline/run-pipeline';
import { addPipelineUsage } from './pipeline/usage-tracker';
import { sendPlanStepToTab } from './tab-messaging';
import {
  MSG,
  type DomTreePayload,
  type ExecuteActionsPayload,
  type GetContentPayload,
  type HighlightPayload,
  type MatchOptionRequest,
  type MatchOptionResponse,
  type PlanStepSocketPayload,
} from './types';

let socket: Socket | null = null;
let socketConnected = false;
let pipelineRunningTabId: number | null = null;

async function broadcastPipelineProgress(tabId: number, progress: PipelineProgress): Promise<void> {
  socket?.emit('pipeline:progress', { tabId, progress });

  const message = { type: MSG.PIPELINE_PROGRESS, progress };
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    for (const frame of frames ?? []) {
      chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  }
}

const KEEP_ALIVE_ALARM = 'oak-socket-keep-alive';
chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM && !socketConnected && socket) {
    socket.connect();
  }
});

async function connectSocket() {
  socket?.disconnect();
  socket = null;
  socketConnected = false;

  const token = await getAccessToken();
  if (!token) return;

  const serverUrl = await getAthensApiUrl();
  socket = io(serverUrl, {
    path: OAK_SOCKET_PATH,
    auth: { token },
    query: { type: 'extension', name: 'Oak Extension' },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    socketConnected = true;
  });

  socket.on('disconnect', () => {
    socketConnected = false;
  });

  socket.on('connect_error', (err) => {
    console.warn('[Oak] socket connect_error:', err.message);
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

  socket.on('dom:plan-step', (payload: PlanStepSocketPayload, ack?: (res: unknown) => void) => {
    const { tabId, step, frameId } = payload ?? {};
    if (!tabId || !step?.action) {
      ack?.({ ok: false, error: 'Missing tabId or step' });
      return;
    }

    void sendPlanStepToTab(tabId, step, frameId)
      .then((res) => ack?.(res))
      .catch((err) =>
        ack?.({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  });
}

void connectSocket();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.athensApiUrl || changes.oakSession) {
    void connectSocket();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.SOCKET_STATUS) {
    sendResponse({ connected: socketConnected });
    return true;
  }

  if (message.type === MSG.AUTH_STATUS) {
    void getOakSession().then((session) => {
      sendResponse({
        signedIn: Boolean(session),
        session,
        connected: socketConnected,
      });
    });
    return true;
  }

  if (message.type === MSG.AUTH_SIGNIN) {
    void (async () => {
      try {
        const session = await oakSignIn(
          String(message.name || ''),
          String(message.password || ''),
          typeof message.apiUrl === 'string' ? message.apiUrl : undefined,
        );
        await connectSocket();
        sendResponse({ ok: true, session });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.AUTH_SIGNOUT) {
    void (async () => {
      try {
        await oakSignOut();
        await connectSocket();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === 'oak:reconnect-socket') {
    void connectSocket().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === MSG.START_PIPELINE) {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ error: 'No tab for pipeline' });
      return true;
    }
    if (pipelineRunningTabId != null) {
      sendResponse({ error: 'A pipeline is already running' });
      return true;
    }

    pipelineRunningTabId = tabId;
    sendResponse({ ok: true });

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          await broadcastPipelineProgress(tabId, {
            phase: 'error',
            message: 'Sign in required',
            error: 'Sign in to Athens in the Oak sidebar first',
          });
          return;
        }

        const apiUrl = await getAthensApiUrl();
        await runFabPipeline({
          tabId,
          preferredFrameId: sender.frameId ?? null,
          aiServerUrl: apiUrl,
          emitDomTree: (payload) => {
            socket?.emit('dom:tree', payload);
          },
          onProgress: (progress) => {
            void broadcastPipelineProgress(tabId, progress);
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await broadcastPipelineProgress(tabId, {
          phase: 'error',
          message: 'Failed',
          error,
        });
      } finally {
        pipelineRunningTabId = null;
      }
    })();

    return true;
  }

  if (message.type === MSG.DEBUG_LOG) {
    const payload = message.payload;
    if (payload && typeof payload === 'object') {
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '4e43d4',
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
    return false;
  }

  if (message.type === MSG.MATCH_OPTION) {
    const body = message.payload as MatchOptionRequest;
    (async () => {
      try {
        const base = await getAthensApiUrl();
        const res = await fetch(`${base}/api/oak/match-option`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as MatchOptionResponse;
        if (!res.ok) {
          sendResponse({
            ok: false,
            matched_option: null,
            error: data.error || `match-option failed: ${res.status}`,
          } satisfies MatchOptionResponse);
          return;
        }
        if (pipelineRunningTabId != null && data.usage) {
          addPipelineUsage(data.usage);
        }
        sendResponse(data);
      } catch (err) {
        sendResponse({
          ok: false,
          matched_option: null,
          error: err instanceof Error ? err.message : String(err),
        } satisfies MatchOptionResponse);
      }
    })();
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
