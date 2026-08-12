import { MSG, type PlanStepPayload, type PlanStepResult } from '../types';
import { controlAlreadyMatches } from './agents/already-filled';
import { fillElement } from './agents/fill';
import { readControlValue } from './agents/read-control-value';
import { selectRadioElement } from './agents/select-radio';
import { uploadFileToElement } from './agents/upload';
import { validateElementIndexes } from './agents/validate';
import { waitMs } from './agents/wait';
import { highlightElement } from './highlighter';
import { verifyElementByPlan } from './verify-element';

function sendDebugLog(
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
        sessionId: '30bd90',
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

function intendedPreview(value: string | null | undefined): string | undefined {
  const n = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (/^(true|yes|no|false|1|0|on|off|checked|unchecked|\d+\+?)$/i.test(n)) return n;
  return undefined;
}

export async function runPlanStep(step: PlanStepPayload): Promise<PlanStepResult> {
  sendDebugLog('F', 'plan-step-runner.ts:entry', 'plan-step entry', {
    action: step.action,
    nodeId: step.element_index ?? null,
    intendedLen: String(step.value ?? '').length,
    intendedPreview: intendedPreview(step.value),
  });

  if (step.action === 'wait') {
    const ms = await waitMs(step.ms);
    return { ok: true, verified: true, acted: true, details: { valueAfter: `${ms}ms` } };
  }

  if (step.action === 'validate') {
    const indexes = step.element_indexes ?? [];
    if (!indexes.length) {
      return { ok: false, verified: false, acted: false, error: 'validate requires element_indexes' };
    }
    const result = validateElementIndexes(indexes);
    return {
      ok: result.ok,
      verified: result.ok,
      acted: true,
      error: result.error,
      details: {
        valueAfter: result.results
          .filter((r) => r.ok)
          .map((r) => `${r.nodeId}=${r.valueAfter ?? ''}`)
          .join(', '),
      },
    };
  }

  if (step.element_index == null) {
    return {
      ok: false,
      verified: false,
      acted: false,
      error: `${step.action} requires element_index`,
    };
  }

  const verified = verifyElementByPlan(
    step.element_index,
    step.expected_label,
    step.expected_role,
  );

  if (!verified.ok || !verified.element) {
    sendDebugLog('F', 'plan-step-runner.ts:verifyFailed', 'plan-step verify failed', {
      action: step.action,
      nodeId: step.element_index,
      error: verified.error || 'Verification failed',
      matchedRole: verified.matchedRole ?? null,
    });
    return {
      ok: false,
      verified: false,
      acted: false,
      error: verified.error || 'Verification failed',
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }

  highlightElement(verified.element, verified.matchedLabel);

  if (step.action === 'verify_only') {
    return {
      ok: true,
      verified: true,
      acted: false,
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }

  // Resume / browser autofill may already populate the control — don't overwrite
  // when the live value already matches the planned answer.
  if (step.action === 'fill' || step.action === 'select_radio' || step.action === 'upload') {
    const prior = controlAlreadyMatches(verified.element, step.value, {
      fileName: step.file?.name ?? null,
    });
    const html = verified.element as HTMLElement;
    const input = verified.element instanceof HTMLInputElement ? verified.element : null;
    // #region agent log
    try {
      chrome.runtime.sendMessage({
        type: MSG.DEBUG_LOG,
        payload: {
          sessionId: '30bd90',
          hypothesisId: prior.matched ? 'B' : 'A',
          location: 'plan-step-runner.ts:alreadyFilledGate',
          message: 'plan-step alreadyFilled gate',
          data: {
            action: step.action,
            nodeId: step.element_index,
            alreadyFilled: prior.matched,
            matchedRole: verified.matchedRole,
            tag: verified.element.tagName,
            role: (html.getAttribute?.('role') || '').toLowerCase(),
            type: input?.type || '',
            checked: input ? input.checked : null,
            ariaChecked: html.getAttribute?.('aria-checked'),
            ariaPressed: html.getAttribute?.('aria-pressed'),
            currentLen: String(prior.current || '').length,
          },
          timestamp: Date.now(),
        },
      });
    } catch {
      /* ignore */
    }
    // #endregion
    if (prior.matched) {
      return {
        ok: true,
        verified: true,
        acted: false,
        alreadyFilled: true,
        details: {
          nodeId: step.element_index,
          matchedLabel: verified.matchedLabel,
          matchedRole: verified.matchedRole,
          valueAfter: prior.current,
        },
      };
    }
  }

  try {
    let valueAfter: string | undefined;

    switch (step.action) {
      case 'fill': {
        if (step.value == null || step.value === '') {
          throw new Error('fill requires value');
        }
        valueAfter = await fillElement(verified.element, step.value);
        break;
      }
      case 'upload': {
        if (!step.file?.base64) {
          throw new Error('upload requires runtime file payload');
        }
        valueAfter = await uploadFileToElement(verified.element, step.file);
        break;
      }
      case 'select_radio': {
        valueAfter = await selectRadioElement(verified.element, step.value);
        const input = verified.element instanceof HTMLInputElement ? verified.element : null;
        sendDebugLog('G', 'plan-step-runner.ts:selectRadioActed', 'select_radio acted', {
          nodeId: step.element_index,
          tag: verified.element.tagName,
          type: input?.type || '',
          checkedAfter: input ? input.checked : null,
          intendedPreview: intendedPreview(step.value),
          valueAfterLen: String(valueAfter || '').length,
        });
        break;
      }
      default:
        throw new Error(`Unsupported plan step action: ${step.action}`);
    }

    const after = valueAfter ?? readControlValue(verified.element);
    return {
      ok: true,
      verified: true,
      acted: true,
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
        valueAfter: after,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    sendDebugLog('G', 'plan-step-runner.ts:actFailed', 'plan-step act failed', {
      action: step.action,
      nodeId: step.element_index,
      tag: verified.element.tagName,
      error,
      intendedPreview: intendedPreview(step.value),
    });
    return {
      ok: false,
      verified: true,
      acted: false,
      error,
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }
}
