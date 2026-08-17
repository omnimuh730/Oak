import { MSG } from '../types';

/** Debug-session ingest via the background worker (content scripts cannot POST to localhost). */
export function oakDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  // #region agent log
  try {
    chrome.runtime.sendMessage({
      type: MSG.DEBUG_LOG,
      payload: {
        sessionId: '543c46',
        runId: 'post-fix',
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      },
    });
  } catch {
    /* ignore */
  }
  // #endregion
}
