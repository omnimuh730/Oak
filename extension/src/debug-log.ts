/** Relays debug NDJSON via the service worker (page fetch to 127.0.0.1 is often blocked). */
export function oakDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  try {
    chrome.runtime.sendMessage({
      type: 'oak:debug-log',
      payload: {
        sessionId: '69bbda',
        location,
        message,
        data,
        hypothesisId,
        timestamp: Date.now(),
      },
    });
  } catch {
    // ignore
  }
}
