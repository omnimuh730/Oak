import type { PlanStepPayload, PlanStepResult } from '../types';
import { controlAlreadyMatches } from './agents/already-filled';
import { fillElement } from './agents/fill';
import { readControlValue } from './agents/read-control-value';
import { selectRadioElement } from './agents/select-radio';
import { uploadFileToElement } from './agents/upload';
import { validateElementIndexes } from './agents/validate';
import { waitMs } from './agents/wait';
import { agentDebugLog } from './debug-log';
import { highlightElement } from './highlighter';
import { verifyElementByPlan } from './verify-element';

export async function runPlanStep(step: PlanStepPayload): Promise<PlanStepResult> {
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
    // #region agent log
    agentDebugLog({
      runId: 'form-frame-v2',
      hypothesisId: 'E',
      location: 'plan-step-runner.ts:verifyFail',
      message: 'Element verify failed',
      data: {
        hostname: location.hostname,
        isTop: window === window.top,
        action: step.action,
        element_index: step.element_index,
        expected_label: step.expected_label,
        expected_role: step.expected_role,
        error: verified.error || null,
        matchedLabel: verified.matchedLabel || null,
        matchedRole: verified.matchedRole || null,
      },
    });
    // #endregion
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
    if (prior.matched) {
      // #region agent log
      agentDebugLog({
        runId: 'option-v1',
        hypothesisId: 'J',
        location: 'plan-step-runner.ts:alreadyFilled',
        message: 'Skipped already filled',
        data: {
          hostname: location.hostname,
          isTop: window === window.top,
          action: step.action,
          element_index: step.element_index,
          expected_role: step.expected_role,
          valueAfterLen: (prior.current || '').length,
          currentPreview: (prior.current || '').slice(0, 40),
          elRole: (verified.element as HTMLElement).getAttribute?.('role') || null,
          elTag: verified.element.tagName,
        },
      });
      // #endregion
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
        break;
      }
      default:
        throw new Error(`Unsupported plan step action: ${step.action}`);
    }

    const after = valueAfter ?? readControlValue(verified.element);
    // #region agent log
    agentDebugLog({
      runId: 'option-v1',
      hypothesisId: 'J',
      location: 'plan-step-runner.ts:acted',
      message: 'Plan step acted',
      data: {
        hostname: location.hostname,
        isTop: window === window.top,
        action: step.action,
        element_index: step.element_index,
        expected_role: step.expected_role,
        matchedRole: verified.matchedRole,
        valueAfterLen: (after || '').length,
        valueAfterPreview: (after || '').slice(0, 40),
        elRole: (verified.element as HTMLElement).getAttribute?.('role') || null,
        elTag: verified.element.tagName,
      },
    });
    // #endregion
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
    return {
      ok: false,
      verified: true,
      acted: false,
      error: err instanceof Error ? err.message : String(err),
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
      },
    };
  }
}
