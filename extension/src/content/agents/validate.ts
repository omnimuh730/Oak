import { oakDebugLog } from '../../debug-log';
import { resolveElementByNodeId } from '../element-resolver';
import { verifyElementByPlan } from '../verify-element';
import { readControlValue } from './read-control-value';

export interface ValidateItemResult {
  nodeId: number;
  ok: boolean;
  error?: string;
  valueAfter?: string;
}

function pageMentionsFilename(name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return (document.body?.innerText || '').toLowerCase().includes(needle);
}

export function validateElementIndexes(indexes: number[]): {
  ok: boolean;
  results: ValidateItemResult[];
  error?: string;
} {
  const results: ValidateItemResult[] = [];
  for (const nodeId of indexes) {
    const raw = resolveElementByNodeId(nodeId);
    const verified = verifyElementByPlan(nodeId, null, null);

    // #region agent log
    const valuePreview = verified.element ? readControlValue(verified.element).slice(0, 80) : '';
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((node) => ({
      oakId: node.getAttribute('data-oak-id'),
      files: Array.from((node as HTMLInputElement).files ?? []).map((f) => f.name),
    }));
    oakDebugLog(
      'validate.ts:item',
      'validate item probe',
      {
        nodeId,
        resolved: Boolean(raw),
        resolvedTag: raw?.tagName ?? null,
        verifyOk: verified.ok,
        verifyError: verified.error ?? null,
        role: verified.matchedRole ?? null,
        valuePreview,
        fileInputCount: fileInputs.length,
        fileInputs: fileInputs.slice(0, 6),
      },
      'D',
    );
    // #endregion

    if (!verified.ok) {
      const stamped = resolveElementByNodeId(nodeId);
      if (
        stamped instanceof HTMLInputElement &&
        stamped.type === 'file' &&
        (stamped.files?.length ?? 0) > 0
      ) {
        results.push({
          nodeId,
          ok: true,
          valueAfter: Array.from(stamped.files ?? []).map((f) => f.name).join(', '),
        });
        continue;
      }
      results.push({ nodeId, ok: false, error: verified.error });
      continue;
    }

    const valueAfter = readControlValue(verified.element);
    const empty =
      !valueAfter ||
      valueAfter === 'false' ||
      (verified.element instanceof HTMLInputElement &&
        verified.element.type === 'file' &&
        !verified.element.files?.length &&
        !pageMentionsFilename(valueAfter));

    if (empty && verified.matchedRole !== 'button' && verified.matchedRole !== 'submit button') {
      results.push({
        nodeId,
        ok: false,
        error: `Element ${nodeId} appears empty`,
        valueAfter,
      });
      continue;
    }
    results.push({ nodeId, ok: true, valueAfter });
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    results,
    error: failed.length
      ? failed.map((f) => f.error || `Element ${f.nodeId} failed`).join('; ')
      : undefined,
  };
}
