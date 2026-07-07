import { runUnsafeCode } from './injected/run-unsafe-code';

export function urlsMatch(frameUrl: string, expectedUrl: string): boolean {
  if (frameUrl === expectedUrl) return true;

  try {
    const current = new URL(frameUrl);
    const target = new URL(expectedUrl);
    return current.origin === target.origin && current.pathname === target.pathname;
  } catch {
    return false;
  }
}

async function frameHasOakMarkers(tabId: number, frameId: number): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: () => document.querySelector('[data-oak-id]') != null,
    });
    return Boolean(injection?.result);
  } catch {
    return false;
  }
}

export async function findFrameId(
  tabId: number,
  expectedUrl: string,
  preferredFrameId?: number,
): Promise<number> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length) throw new Error('No frames found in tab');

  if (preferredFrameId != null) {
    const preferred = frames.find((f) => f.frameId === preferredFrameId);
    if (preferred) return preferred.frameId;
  }

  const candidates = frames.filter(
    (f) => f.url === expectedUrl || urlsMatch(f.url, expectedUrl),
  );

  for (const frame of candidates) {
    if (await frameHasOakMarkers(tabId, frame.frameId)) {
      return frame.frameId;
    }
  }

  const exact = candidates[0] ?? frames.find((f) => f.url === expectedUrl);
  if (exact) return exact.frameId;

  const loose = frames.find((f) => urlsMatch(f.url, expectedUrl));
  if (loose) return loose.frameId;

  const top = frames.find((f) => f.parentFrameId === -1);
  if (top) return top.frameId;

  return frames[0].frameId;
}

export async function evalScriptInTab(
  tabId: number,
  url: string,
  code: string,
  frameId?: number,
): Promise<string> {
  const targetFrameId = await findFrameId(tabId, url, frameId);

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [targetFrameId] },
    world: 'MAIN',
    func: runUnsafeCode,
    args: [code],
  });

  if (injection?.result === undefined) {
    throw new Error('Script eval returned no result');
  }

  return injection.result;
}
