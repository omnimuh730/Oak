import type { PlanStepPayload, PlanStepResult } from '../types';
import {
  rewriteApplicantIdentityValue,
} from '../../../shared/plan-runner/applicant-identity';
import { controlAlreadyMatches } from './agents/already-filled';
import { fillElement } from './agents/fill';
import { readControlValue } from './agents/read-control-value';
import { resumeUpload } from './agents/resume-upload';
import { selectRadioElement } from './agents/select-radio';
import { uploadFileToElement } from './agents/upload';
import { validateElementIndexes } from './agents/validate';
import { waitMs } from './agents/wait';
import { oakDebugLog } from './debug-log';
import { highlightElement } from './highlighter';
import { relocateElementByPlan, verifyElementByPlan } from './verify-element';

function sendDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  oakDebugLog(hypothesisId, location, message, data);
}

function nearbyQuestionText(el: Element, expectedLabel: string | null): string {
  const bits = [expectedLabel || ''];
  const html = el as HTMLElement;
  bits.push(html.getAttribute('aria-label') || '');
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    bits.push(node.getAttribute('aria-label') || '');
    const heading = node.querySelector(
      ':scope > label, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4',
    );
    if (heading?.textContent) bits.push(heading.textContent);
    const prev = node.previousElementSibling as HTMLElement | null;
    if (prev) bits.push(prev.innerText || prev.textContent || '');
    node = node.parentElement;
  }
  return bits.join(' ');
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
    if (step.action === 'resume_upload' && step.file?.base64) {
      const root = document.body || document.documentElement;
      sendDebugLog('C', 'plan-step-runner.ts:resumeNoIndex', 'resume_upload without index', {
        action: step.action,
        hasRoot: Boolean(root),
      });
      if (!root) {
        return {
          ok: false,
          verified: false,
          acted: false,
          error: `${step.action} requires element_index`,
        };
      }
      try {
        const valueAfter = await resumeUpload(root, step.file, step.expected_label);
        return {
          ok: true,
          verified: true,
          acted: true,
          details: { valueAfter },
        };
      } catch (err) {
        return {
          ok: false,
          verified: true,
          acted: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return {
      ok: false,
      verified: false,
      acted: false,
      error: `${step.action} requires element_index`,
    };
  }

  let verified = verifyElementByPlan(
    step.element_index,
    step.expected_label,
    step.expected_role,
  );

  if (!verified.ok || !verified.element) {
    const fallback = relocateElementByPlan(
      step.expected_label,
      step.expected_role,
      step.value,
    );
    sendDebugLog('I', 'plan-step-runner.ts:relocate', 'stale index relocate', {
      action: step.action,
      nodeId: step.element_index,
      indexError: verified.error || 'Verification failed',
      relocated: fallback.ok,
      matchRole: fallback.matchedRole ?? null,
      expectedRole: step.expected_role,
      expectedLabelLen: String(step.expected_label || '').length,
      password: /password/i.test(String(step.expected_label || '')),
      email: /e-?mail/i.test(String(step.expected_label || '')),
      sms: /text message|sms|consent to receive/i.test(String(step.expected_label || '')),
    });
    if (fallback.ok && fallback.element) {
      verified = fallback;
    } else {
      sendDebugLog('B', 'plan-step-runner.ts:verifyFailed', 'plan-step verify failed', {
        action: step.action,
        nodeId: step.element_index,
        error: verified.error || 'Verification failed',
        expectedRole: step.expected_role,
        matchedRole: verified.matchedRole ?? null,
        expectedLabelLen: String(step.expected_label || '').length,
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
  }

  const el = verified.element;
  if (!el) {
    return {
      ok: false,
      verified: false,
      acted: false,
      error: verified.error || 'Verification failed',
    };
  }

  highlightElement(el, verified.matchedLabel);

  const questionText = nearbyQuestionText(
    el,
    [step.expected_label, verified.matchedLabel].filter(Boolean).join(' '),
  );
  let intended = step.value;
  const identityValue = rewriteApplicantIdentityValue(questionText, intended);
  if (identityValue !== intended) {
    sendDebugLog('F', 'plan-step-runner.ts:identityRewrite', 'rewrote AI-tool consent value', {
      action: step.action,
      nodeId: step.element_index,
      fromPreview: intendedPreview(intended),
      toPreview: intendedPreview(identityValue),
      questionLen: questionText.length,
    });
    intended = identityValue ?? null;
  }

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
  if (step.action === 'fill' || step.action === 'select_radio' || step.action === 'upload' || step.action === 'resume_upload') {
    const prior = controlAlreadyMatches(el, intended, {
      fileName: step.file?.name ?? null,
    });
    const html = el as HTMLElement;
    const input = el instanceof HTMLInputElement ? el : null;
    sendDebugLog(prior.matched ? 'F' : 'A', 'plan-step-runner.ts:alreadyFilledGate', 'plan-step alreadyFilled gate', {
      action: step.action,
      nodeId: step.element_index,
      alreadyFilled: prior.matched,
      matchedRole: verified.matchedRole,
      tag: el.tagName,
      role: (html.getAttribute?.('role') || '').toLowerCase(),
      type: input?.type || '',
      currentLen: String(prior.current || '').length,
      expectedLabelLen: String(step.expected_label || '').length,
      password: /password/i.test(String(step.expected_label || '')),
      email: /e-?mail/i.test(String(step.expected_label || '')),
      nameField: /\bname\b/i.test(String(step.expected_label || '')),
      phoneField: /\b(phone|mobile|tel)\b/i.test(String(step.expected_label || '')),
      urlField: /\b(linkedin|url|website|portfolio)\b/i.test(String(step.expected_label || '')),
      preferred: /preferred/i.test(String(step.expected_label || '')),
      sms: /text message|sms|consent to receive/i.test(String(step.expected_label || '')),
    });
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
        if (intended == null || intended === '') {
          throw new Error('fill requires value');
        }
        valueAfter = await fillElement(el, intended, step.expected_label);
        sendDebugLog('C', 'plan-step-runner.ts:fillActed', 'fill acted', {
          nodeId: step.element_index,
          tag: el.tagName,
          type: el instanceof HTMLInputElement ? el.type : '',
          valueAfterLen: String(valueAfter || '').length,
          liveLen: String(readControlValue(el) || '').length,
          expectedLabelLen: String(step.expected_label || '').length,
          nameField: /\bname\b/i.test(String(step.expected_label || '')),
          phoneField: /\b(phone|mobile|tel)\b/i.test(String(step.expected_label || '')),
          urlField: /\b(linkedin|url|website|portfolio)\b/i.test(String(step.expected_label || '')),
          ariaInvalid: (el as HTMLElement).getAttribute?.('aria-invalid'),
        });
        break;
      }
      case 'upload': {
        if (!step.file?.base64) {
          throw new Error('upload requires runtime file payload');
        }
        valueAfter = await uploadFileToElement(el, step.file);
        break;
      }
      case 'resume_upload': {
        if (!step.file?.base64) {
          throw new Error('resume_upload requires the recommended Library resume');
        }
        valueAfter = await resumeUpload(
          el,
          step.file,
          step.expected_label,
        );
        break;
      }
      case 'select_radio': {
        valueAfter = await selectRadioElement(el, intended);
        const input = el instanceof HTMLInputElement ? el : null;
        sendDebugLog('G', 'plan-step-runner.ts:selectRadioActed', 'select_radio acted', {
          nodeId: step.element_index,
          tag: el.tagName,
          type: input?.type || '',
          checkedAfter: input ? input.checked : null,
          intendedPreview: intendedPreview(intended),
          valueAfterLen: String(valueAfter || '').length,
        });
        break;
      }
      default:
        throw new Error(`Unsupported plan step action: ${step.action}`);
    }

    const after = valueAfter ?? readControlValue(el);
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
      tag: el.tagName,
      error,
      intendedPreview: intendedPreview(intended),
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
