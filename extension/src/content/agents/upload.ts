import { oakDebugLog } from '../../debug-log';
import type { RuntimeAttachedFile } from '../../types';
import { resolveElementByNodeId } from '../element-resolver';
import { waitMs } from './wait';

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildFile(file: RuntimeAttachedFile): File {
  const bytes = base64ToUint8Array(file.base64);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: file.mimeType || 'application/octet-stream' });
  return new File([blob], file.name, {
    type: file.mimeType || 'application/octet-stream',
  });
}

function applyFiles(input: HTMLInputElement, fileObj: File): string[] {
  const dt = new DataTransfer();
  dt.items.add(fileObj);
  try {
    input.files = dt.files;
  } catch {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    desc?.set?.call(input, dt.files);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return Array.from(input.files ?? []).map((f) => f.name);
}

function listFileInputs(doc: Document = document): HTMLInputElement[] {
  return Array.from(doc.querySelectorAll('input[type="file"]')).filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement && node.isConnected,
  );
}

function pageMentionsFilename(doc: Document, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return (doc.body?.innerText || '').toLowerCase().includes(needle);
}

/**
 * Some apps remount file inputs on change. Re-apply at most once to a successor.
 * If the control disappears after attach and the filename appears in the page, treat as success.
 */
async function persistUploadAcrossRemount(
  original: HTMLInputElement,
  fileObj: File,
  oakId: string | null,
): Promise<{ names: string[]; input: HTMLInputElement }> {
  const doc = original.ownerDocument || document;
  let target = original;
  let names = applyFiles(target, fileObj);
  let reapplied = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    await waitMs(120);

    if (target.isConnected && (target.files?.length ?? 0) > 0) {
      if (oakId) target.setAttribute('data-oak-id', oakId);
      return { names: Array.from(target.files ?? []).map((f) => f.name), input: target };
    }

    if (names.length && pageMentionsFilename(doc, names[0])) {
      // #region agent log
      oakDebugLog(
        'upload.ts:remount',
        'upload accepted via page filename',
        { attempt, oakId, names, targetConnected: target.isConnected },
        'A',
      );
      // #endregion
      if (oakId && target.isConnected) target.setAttribute('data-oak-id', oakId);
      return { names, input: target };
    }

    const connected = listFileInputs(doc);
    const form = target.form || original.form;
    const inForm = form ? connected.filter((node) => node.form === form) : connected;
    const pool = inForm.length > 0 ? inForm : connected;
    const successor =
      (oakId
        ? pool.find((node) => node.getAttribute('data-oak-id') === oakId)
        : undefined) ||
      pool.find((node) => (node.files?.length ?? 0) > 0) ||
      pool.find((node) => node !== target && (node.files?.length ?? 0) === 0) ||
      pool.find((node) => node !== target) ||
      pool[0];

    // #region agent log
    oakDebugLog(
      'upload.ts:remount',
      'file input remount loop',
      {
        attempt,
        oakId,
        targetConnected: target.isConnected,
        targetFiles: target.files?.length ?? 0,
        successorOakId: successor?.getAttribute('data-oak-id') ?? null,
        successorFiles: successor ? successor.files?.length ?? 0 : null,
        connectedCount: connected.length,
        pageHasName: names[0] ? pageMentionsFilename(doc, names[0]) : false,
        reapplied,
      },
      'A',
    );
    // #endregion

    if (successor && (successor.files?.length ?? 0) > 0) {
      if (oakId) successor.setAttribute('data-oak-id', oakId);
      return {
        names: Array.from(successor.files ?? []).map((f) => f.name),
        input: successor,
      };
    }

    if (!successor) break;

    // Re-apply once only — a second attach can wipe an already-accepted upload.
    if (reapplied) {
      target = successor;
      if (oakId) successor.setAttribute('data-oak-id', oakId);
      continue;
    }

    if (oakId) successor.setAttribute('data-oak-id', oakId);
    target = successor;
    names = applyFiles(target, fileObj);
    reapplied = true;
  }

  if (target.isConnected && (target.files?.length ?? 0) > 0) {
    if (oakId) target.setAttribute('data-oak-id', oakId);
    return { names: Array.from(target.files ?? []).map((f) => f.name), input: target };
  }

  if (names.length && pageMentionsFilename(doc, names[0])) {
    return { names, input: target };
  }

  throw new Error('Upload did not persist after the page remounted the file input');
}

export async function uploadFileToElement(
  el: Element,
  file: RuntimeAttachedFile,
): Promise<string> {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
    throw new Error(`Upload target is not a file input (got <${el.tagName.toLowerCase()}>)`);
  }

  const oakId = el.getAttribute('data-oak-id');
  const fileObj = buildFile(file);
  const { names, input } = await persistUploadAcrossRemount(el, fileObj, oakId);

  // #region agent log
  const stillThere = oakId ? resolveElementByNodeId(Number(oakId)) : input.isConnected ? input : null;
  const fileInputs = listFileInputs(el.ownerDocument || document).map((node) => ({
    oakId: node.getAttribute('data-oak-id'),
    files: Array.from(node.files ?? []).map((f) => f.name),
    connected: node.isConnected,
  }));
  oakDebugLog(
    'upload.ts:after',
    'upload completed DOM snapshot',
    {
      oakId,
      names,
      elConnected: input.isConnected,
      resolveAfterUpload: Boolean(stillThere),
      resolveOakId: stillThere?.getAttribute('data-oak-id') ?? null,
      fileInputCount: fileInputs.length,
      fileInputs: fileInputs.slice(0, 6),
      pageHasName: names[0] ? pageMentionsFilename(el.ownerDocument || document, names[0]) : false,
    },
    'A',
  );
  // #endregion

  if (!names.length) {
    throw new Error('File was not attached to input');
  }
  return names.join(', ');
}
