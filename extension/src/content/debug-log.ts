import { MSG } from '../types';

const INGEST =
  'http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31';

/** Debug NDJSON via background (page CSP-safe) + direct fetch fallback. */
export function agentDebugLog(payload: {
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  const body = {
    sessionId: '4e43d4',
    timestamp: Date.now(),
    ...payload,
  };
  try {
    chrome.runtime.sendMessage({ type: MSG.DEBUG_LOG, payload: body }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // ignore
  }
  fetch(INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '4e43d4',
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}
