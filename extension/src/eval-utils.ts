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

function isCspEvalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /EvalError|Content Security Policy|unsafe-eval|Refused to evaluate/i.test(msg);
}

type EvalWorld = 'MAIN' | 'ISOLATED';

async function runEvalInWorld(
  tabId: number,
  frameId: number,
  code: string,
  world: EvalWorld,
): Promise<string> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    ...(world === 'MAIN' ? { world: 'MAIN' as const } : {}),
    func: runUnsafeCode,
    args: [code],
  });

  if (injection?.result === undefined) {
    throw new Error('Script eval returned no result');
  }

  return injection.result;
}

async function frameContainsOakId(
  tabId: number,
  frameId: number,
  oakNodeId: number,
): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (nodeId: number) => {
        function queryDeep(root: Document | Element | ShadowRoot, sel: string): Element | null {
          if ('querySelector' in root) {
            const direct = root.querySelector(sel);
            if (direct) return direct;
          }
          const nodes = 'querySelectorAll' in root ? root.querySelectorAll('*') : [];
          for (const child of Array.from(nodes)) {
            if (child.shadowRoot) {
              const found = queryDeep(child.shadowRoot, sel);
              if (found) return found;
            }
            if (child.tagName === 'IFRAME') {
              try {
                const doc = (child as HTMLIFrameElement).contentDocument;
                if (doc) {
                  const found = queryDeep(doc, `[data-oak-id="${nodeId}"]`);
                  if (found) return found;
                }
              } catch {
                // cross-origin iframe
              }
            }
          }
          return null;
        }
        return queryDeep(document, `[data-oak-id="${nodeId}"]`) != null;
      },
      args: [oakNodeId],
    });
    return Boolean(injection?.result);
  } catch {
    return false;
  }
}

async function findFrameForOakId(
  tabId: number,
  oakNodeId: number,
  frames: chrome.webNavigation.GetAllFrameResultDetails[],
): Promise<number | null> {
  for (const frame of frames) {
    if (await frameContainsOakId(tabId, frame.frameId, oakNodeId)) {
      return frame.frameId;
    }
  }
  return null;
}

export async function findFrameId(
  tabId: number,
  expectedUrl: string,
  preferredFrameId?: number,
  oakNodeId?: number,
): Promise<number> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length) throw new Error('No frames found in tab');

  if (oakNodeId != null) {
    const frameWithNode = await findFrameForOakId(tabId, oakNodeId, frames);
    if (frameWithNode != null) return frameWithNode;
  }

  if (preferredFrameId != null) {
    const preferred = frames.find((f) => f.frameId === preferredFrameId);
    if (preferred) return preferred.frameId;
  }

  const top = frames.find((f) => f.parentFrameId === -1);
  if (top) return top.frameId;

  const exact = frames.find((f) => f.url === expectedUrl);
  if (exact) return exact.frameId;

  const loose = frames.find((f) => urlsMatch(f.url, expectedUrl));
  if (loose) return loose.frameId;

  return frames[0].frameId;
}

export async function evalScriptInTab(
  tabId: number,
  url: string,
  code: string,
  frameId?: number,
  oakNodeId?: number,
): Promise<string> {
  const targetFrameId = await findFrameId(tabId, url, frameId, oakNodeId);

  // Isolated extension world is NOT subject to page CSP — primary path for Ashby etc.
  try {
    return await runEvalInWorld(tabId, targetFrameId, code, 'ISOLATED');
  } catch (isolatedErr) {
    try {
      return await runEvalInWorld(tabId, targetFrameId, code, 'MAIN');
    } catch (mainErr) {
      if (isCspEvalError(mainErr) && !isCspEvalError(isolatedErr)) {
        throw isolatedErr instanceof Error ? isolatedErr : new Error(String(isolatedErr));
      }
      throw mainErr instanceof Error ? mainErr : new Error(String(mainErr));
    }
  }
}
