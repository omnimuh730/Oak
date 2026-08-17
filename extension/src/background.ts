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
import { openWorkerJobInTab } from './open-worker-job';
import { sendPlanStepToTab } from './tab-messaging';
import {
  getTabJob,
  unbindJobFromAllTabs,
  unbindTabJob,
} from './tab-job-session';
import { clearTabPipeline, queueTabPipeline } from './tab-pipeline-session';
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
/** Tabs with an in-flight FAB pipeline (parallel across tabs; one per tab). */
const pipelineRunningTabIds = new Set<number>();

function enableSidePanelOnActionClick(): void {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => {
      console.warn('[Oak] side panel behavior:', err);
    });
}

/** Tab the caller pinned. Never the currently focused tab — Fill must stay on the tab that was active at click. */
function pinnedTabId(
  requestedTabId: unknown,
  sender: chrome.runtime.MessageSender,
): number | null {
  if (typeof requestedTabId === 'number' && Number.isFinite(requestedTabId)) {
    return requestedTabId;
  }
  return sender.tab?.id ?? null;
}

async function resolvePreferredTabId(
  sender: chrome.runtime.MessageSender,
  requestedTabId: unknown,
): Promise<number | null> {
  const pinned = pinnedTabId(requestedTabId, sender);
  if (pinned != null) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

function broadcastPipelineProgress(tabId: number, progress: PipelineProgress): void {
  socket?.emit('pipeline:progress', { tabId, progress });
  void queueTabPipeline(tabId, progress);
  chrome.runtime.sendMessage(
    { type: MSG.PIPELINE_PROGRESS, tabId, progress },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

const KEEP_ALIVE_ALARM = 'oak-socket-keep-alive';
// #region agent log
const DEBUG_LOG_INGEST_URL =
  'http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31';
const DEBUG_LOG_SESSION_ID = '543c46';
// #endregion
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
enableSidePanelOnActionClick();
chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);

chrome.tabs.onRemoved.addListener((tabId) => {
  void unbindTabJob(tabId);
  void clearTabPipeline(tabId);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.athensApiUrl || changes.oakSession) {
    void connectSocket();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.DEBUG_LOG) {
    // #region agent log
    const payload = message.payload ?? {};
    fetch(DEBUG_LOG_INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': DEBUG_LOG_SESSION_ID },
      body: JSON.stringify(payload),
    }).catch(() => {});
    // #endregion
    return false;
  }

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

  if (message.type === MSG.LIST_WORKER_JOBS) {
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          sendResponse({ ok: false, error: 'Sign in required', jobs: [] });
          return;
        }
        const base = await getAthensApiUrl();
        const res = await fetch(`${base}/api/oak/jobs`, {
          headers: await authHeaders(),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          jobs?: unknown[];
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          sendResponse({
            ok: false,
            error: data.message || data.error || `Jobs failed (${res.status})`,
            jobs: [],
          });
          return;
        }
        sendResponse({ ok: true, jobs: Array.isArray(data.jobs) ? data.jobs : [] });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          jobs: [],
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.OPEN_WORKER_JOB) {
    void (async () => {
      try {
        const applyUrl = String(message.applyUrl || '').trim();
        const jobId = String(message.jobId || '').trim();
        if (!jobId) {
          sendResponse({ ok: false, error: 'Missing job id' });
          return;
        }
        if (!applyUrl) {
          sendResponse({ ok: false, error: 'This job has no apply URL' });
          return;
        }
        const preferredTabId = await resolvePreferredTabId(sender, message.tabId);
        const opened = await openWorkerJobInTab({
          preferredTabId,
          job: {
            jobId,
            resumeId:
              typeof message.resumeId === 'string' && message.resumeId.trim()
                ? message.resumeId.trim()
                : null,
            resumeStack:
              typeof message.resumeStack === 'string' && message.resumeStack.trim()
                ? message.resumeStack.trim()
                : null,
            applyUrl,
            title: String(message.title || ''),
            company: String(message.company || ''),
          },
        });
        sendResponse({ ok: true, tabId: opened.tabId, reused: opened.reused });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.type === MSG.MARK_JOB_APPLIED) {
    void (async () => {
      try {
        const jobId = String(message.jobId || '').trim();
        if (!jobId) {
          sendResponse({ ok: false, error: 'Missing job id' });
          return;
        }
        const token = await getAccessToken();
        if (!token) {
          sendResponse({ ok: false, error: 'Sign in required' });
          return;
        }
        const base = await getAthensApiUrl();
        const res = await fetch(
          `${base}/api/oak/jobs/${encodeURIComponent(jobId)}/mark-applied`,
          {
            method: 'POST',
            headers: await authHeaders(),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          message?: string;
          error?: string;
        };
        if (!res.ok || data.success === false) {
          sendResponse({
            ok: false,
            error:
              data.message ||
              data.error ||
              `Mark applied failed (${res.status})`,
          });
          return;
        }
        await unbindJobFromAllTabs(jobId);
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

  if (message.type === MSG.GET_TAB_JOB) {
    void (async () => {
      let tabId =
        typeof message.tabId === 'number'
          ? message.tabId
          : sender.tab?.id ?? null;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        tabId = tab?.id ?? null;
      }
      if (!tabId) {
        sendResponse({ ok: false, job: null });
        return;
      }
      sendResponse({ ok: true, job: await getTabJob(tabId) });
    })();
    return true;
  }

  if (message.type === 'oak:reconnect-socket') {
    void connectSocket().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === MSG.START_PIPELINE) {
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (!tabId) {
        sendResponse({ error: 'No tab for pipeline' });
        return;
      }
      if (pipelineRunningTabIds.has(tabId)) {
        sendResponse({ error: 'A pipeline is already running on this tab' });
        return;
      }

      pipelineRunningTabIds.add(tabId);
      sendResponse({ ok: true });

      try {
        const token = await getAccessToken();
        if (!token) {
          broadcastPipelineProgress(tabId, {
            phase: 'error',
            message: 'Sign in required',
            error: 'Sign in to Athens in the Oak sidebar first',
          });
          return;
        }

        const apiUrl = await getAthensApiUrl();
        await runFabPipeline({
          tabId,
          preferredFrameId: sender.tab ? sender.frameId ?? null : null,
          aiServerUrl: apiUrl,
          emitDomTree: (payload) => {
            socket?.emit('dom:tree', payload);
          },
          onProgress: (progress) => {
            broadcastPipelineProgress(tabId, progress);
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        broadcastPipelineProgress(tabId, {
          phase: 'error',
          message: 'Failed',
          error,
        });
      } finally {
        pipelineRunningTabIds.delete(tabId);
      }
    })();

    return true;
  }

  if (message.type === MSG.MATCH_OPTION) {
    const incoming = message.payload as MatchOptionRequest;
    const usageTabId = sender.tab?.id;
    (async () => {
      try {
        const base = await getAthensApiUrl();
    const payload: Record<string, unknown> = {
      intendedValue: incoming.intendedValue,
      options: incoming.options.filter(
        (opt): opt is string => typeof opt === 'string' && opt.trim().length > 0,
      ),
    };
        if (typeof incoming.fieldLabel === 'string' && incoming.fieldLabel.trim()) {
          payload.fieldLabel = incoming.fieldLabel;
        }
        if (typeof incoming.typedQuery === 'string' && incoming.typedQuery.trim()) {
          payload.typedQuery = incoming.typedQuery;
        }
        const res = await fetch(`${base}/api/oak/match-option`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as MatchOptionResponse;
        if (!res.ok) {
          // #region agent log
          fetch(DEBUG_LOG_INGEST_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': DEBUG_LOG_SESSION_ID,
            },
            body: JSON.stringify({
              sessionId: DEBUG_LOG_SESSION_ID,
              runId: 'post-fix',
              hypothesisId: 'G',
              location: 'background.ts:matchOption',
              message: 'match-option http error',
              data: {
                status: res.status,
                optionCount: incoming.options?.length ?? 0,
                apiHost: (() => {
                  try {
                    return new URL(base).host;
                  } catch {
                    return 'invalid';
                  }
                })(),
                errorKind: typeof data.error === 'string' ? data.error.slice(0, 80) : undefined,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          sendResponse({
            ok: false,
            matched_option: null,
            error: data.error || `match-option failed: ${res.status}`,
          } satisfies MatchOptionResponse);
          return;
        }
        if (
          usageTabId != null &&
          pipelineRunningTabIds.has(usageTabId) &&
          data.usage
        ) {
          addPipelineUsage(usageTabId, data.usage);
        }
        sendResponse({ ...data, ok: data.ok !== false });
        // #region agent log
        fetch(DEBUG_LOG_INGEST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': DEBUG_LOG_SESSION_ID,
          },
          body: JSON.stringify({
            sessionId: DEBUG_LOG_SESSION_ID,
            runId: 'post-fix',
            hypothesisId: 'G',
            location: 'background.ts:matchOption',
            message: 'match-option http ok',
            data: {
              status: res.status,
              optionCount: incoming.options?.length ?? 0,
              apiHost: (() => {
                try {
                  return new URL(base).host;
                } catch {
                  return 'invalid';
                }
              })(),
              hasMatch: Boolean(data.matched_option),
              ok: data.ok !== false,
              errorKind: typeof data.error === 'string' ? data.error.slice(0, 80) : undefined,
              confidence: typeof data.confidence === 'number'
                ? Math.round(data.confidence * 100)
                : 0,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
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
    void (async () => {
      const tabId = pinnedTabId(message.tabId, sender);
      if (!tabId) {
        sendResponse({ error: 'No tab for DOM fetch' });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: MSG.FETCH_DOM });

        if (result?.error) {
          sendResponse({ error: result.error });
          return;
        }

        if (!result?.tree) {
          sendResponse({ error: 'No DOM tree returned from page' });
          return;
        }

        const payload: DomTreePayload = { ...result, tabId };

        if (message.type === MSG.FETCH_AND_EMIT_DOM) {
          socket?.emit('dom:tree', payload);
        }

        sendResponse(payload);
      } catch (err) {
        sendResponse({ error: String(err) });
      }
    })();
    return true;
  }
});
