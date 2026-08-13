import type { RuntimeAttachedFile } from '../../types';
import { uploadFileToElement } from './upload';
import {
  documentFieldKind,
  labelLooksLikeOtherDocument,
  type DocumentFieldKind,
} from '../../../../shared/plan-runner/resume-field';

function isFileInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'file';
}

function inputHaystack(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.getAttribute('aria-label') || '',
    input.getAttribute('placeholder') || '',
    input.accept || '',
  ].join(' ');
}

function sectionHaystack(el: Element): string {
  const bits: string[] = [];
  let node: Element | null = el;
  for (let i = 0; i < 6 && node; i += 1) {
    const labeled =
      node.getAttribute('aria-label') ||
      node.getAttribute('data-label') ||
      '';
    if (labeled) bits.push(labeled);
    const heading = node.querySelector(
      ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > label',
    );
    if (heading?.textContent) bits.push(heading.textContent);
    node = node.parentElement;
  }
  return bits.join(' ');
}

function combinedKind(
  input: HTMLInputElement,
  clicked: Element,
  expectedLabel: string | null | undefined,
): DocumentFieldKind {
  const kinds = [
    documentFieldKind(inputHaystack(input)),
    documentFieldKind(sectionHaystack(input)),
    documentFieldKind(sectionHaystack(clicked)),
    documentFieldKind(expectedLabel || ''),
  ];
  if (kinds.includes('resume')) return 'resume';
  if (kinds.includes('other')) return 'other';
  return 'unknown';
}

function collectFileInputsNear(el: Element): HTMLInputElement[] {
  const found = new Set<HTMLInputElement>();
  if (isFileInput(el)) found.add(el);
  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i += 1) {
    for (const item of node.querySelectorAll('input[type="file"]')) {
      if (isFileInput(item) && item.isConnected) found.add(item);
    }
    node = node.parentElement;
  }
  return [...found];
}

function resolveResumeFileInput(
  el: Element,
  expectedLabel: string | null | undefined,
): HTMLInputElement {
  const ranked = collectFileInputsNear(el)
    .map((input) => ({
      input,
      kind: combinedKind(input, el, expectedLabel),
    }))
    .filter((row) => row.kind !== 'other');
  const resume = ranked.find((row) => row.kind === 'resume');
  if (resume) return resume.input;

  const expected = documentFieldKind(expectedLabel || '');
  const section = documentFieldKind(sectionHaystack(el));
  if (
    (expected === 'resume' || section === 'resume') &&
    ranked.length > 0
  ) {
    return ranked[0].input;
  }

  throw new Error('No Resume/CV file input found near this control');
}

/**
 * Attach the Job Search recommended Library resume to a Resume/CV file input.
 * Never targets cover letters or other document controls.
 */
export async function resumeUpload(
  el: Element,
  file: RuntimeAttachedFile,
  expectedLabel?: string | null,
): Promise<string> {
  if (labelLooksLikeOtherDocument(expectedLabel)) {
    throw new Error('Recommended resume can only be attached to a Resume/CV control');
  }
  const input = resolveResumeFileInput(el, expectedLabel);
  return uploadFileToElement(input, file);
}
