import type { RuntimeAttachedFile } from '../../types';
import { uploadFileToElement } from './upload';

function isFileInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'file';
}

function fileInputScore(input: HTMLInputElement): number {
  const hay = `${input.name} ${input.id} ${input.getAttribute('aria-label') || ''} ${input.accept || ''}`.toLowerCase();
  if (/(resume|cv|curriculum)/.test(hay)) return 2;
  return 1;
}

/** Hidden file inputs often sit next to an Attach button, not as the clicked node. */
function findFileInputNear(el: Element): HTMLInputElement | null {
  if (isFileInput(el)) return el;
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    const found = Array.from(node.querySelectorAll('input[type="file"]')).filter(
      (item): item is HTMLInputElement => isFileInput(item) && item.isConnected,
    );
    if (found.length) {
      return [...found].sort((a, b) => fileInputScore(b) - fileInputScore(a))[0];
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Attach the Job Search recommended Library resume to a file input.
 * Called when the AI plan emits `resume_upload`.
 */
export async function resumeUpload(
  el: Element,
  file: RuntimeAttachedFile,
): Promise<string> {
  const input = findFileInputNear(el);
  if (!input) {
    throw new Error('Resume upload target is not a file input');
  }
  return uploadFileToElement(input, file);
}
