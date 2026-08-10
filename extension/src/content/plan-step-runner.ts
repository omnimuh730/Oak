import type { PlanStepPayload, PlanStepResult } from '../types';
import { fillElement } from './agents/fill';
import { readControlValue } from './agents/read-control-value';
import { selectRadioElement } from './agents/select-radio';
import { uploadFileToElement } from './agents/upload';
import { validateElementIndexes } from './agents/validate';
import { waitMs } from './agents/wait';
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

    return {
      ok: true,
      verified: true,
      acted: true,
      details: {
        nodeId: step.element_index,
        matchedLabel: verified.matchedLabel,
        matchedRole: verified.matchedRole,
        valueAfter: valueAfter ?? readControlValue(verified.element),
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
