import { MSG, type PlanStepPayload } from '../types';
import { serializeDom, getDirectText } from './dom-serializer';
import { resolveElementByNodeId } from './element-resolver';
import { executeActions, getElementContent } from './action-runner';
import { formControlScore, isOakDomFrame } from './form-frame';
import { clearHighlight, highlightElement } from './highlighter';
import { injectOakUI } from './inject-ui';
import { runPlanStep } from './plan-step-runner';

injectOakUI();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.FETCH_DOM) {
    const oakFrame = isOakDomFrame();
    const score = formControlScore();
    if (!oakFrame) {
      sendResponse({
        skipped: true,
        formScore: score,
        url: window.location.href,
        title: document.title,
        fetchedAt: new Date().toISOString(),
        error: 'Not a form frame',
      });
      return false;
    }

    try {
      const tree = serializeDom();
      sendResponse({
        url: window.location.href,
        title: document.title,
        tree,
        formScore: score,
        fetchedAt: new Date().toISOString(),
        // sender.frameId is the extension caller; background should attach the real frame id.
        frameId: sender.frameId ?? null,
      });
    } catch (err) {
      sendResponse({ error: String(err), formScore: score });
    }
    return true;
  }

  if (message.type === MSG.HIGHLIGHT) {
    if (!isOakDomFrame()) return false;

    try {
      const el = resolveElementByNodeId(message.nodeId as number);
      if (el) {
        const text = getDirectText(el);
        highlightElement(el, text);
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'Element not found in DOM' });
      }
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.GET_CONTENT) {
    if (!isOakDomFrame()) return false;

    try {
      const content = getElementContent(
        message.nodeId as number,
        message.contentType as 'innerHTML' | 'innerText',
      );
      sendResponse({ ok: true, content });
    } catch (err) {
      sendResponse({ error: String(err) });
    }
    return true;
  }

  if (message.type === MSG.EXECUTE_ACTIONS) {
    if (!isOakDomFrame()) return false;

    executeActions(message.nodeId as number, message.steps)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }

  if (message.type === MSG.PLAN_STEP) {
    // Non-form frames must not claim the async channel (that caused silent hangs).
    if (!isOakDomFrame()) {
      sendResponse({ ok: false, skipped: true, error: 'Not a form frame' });
      return false;
    }

    let settled = false;
    const respond = (payload: unknown) => {
      if (settled) return;
      settled = true;
      try {
        sendResponse(payload);
      } catch {
        // Channel may already be closed
      }
    };

    const timer = setTimeout(() => {
      respond({
        ok: false,
        error: 'Plan step handler timed out inside the page (20s)',
      });
    }, 20000);

    runPlanStep(message.step as PlanStepPayload)
      .then((result) => {
        clearTimeout(timer);
        respond(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        respond({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }

  if (message.type === MSG.CLEAR_HIGHLIGHT) {
    if (!isOakDomFrame()) return false;

    clearHighlight();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
