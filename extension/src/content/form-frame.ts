/**
 * Detect which browsing context owns a fillable application form.
 * Vendor-agnostic: score live DOM controls — never hostname allowlists.
 */

/** Minimum fillable controls for a child frame to participate in Oak. */
export const MIN_CHILD_FORM_CONTROLS = 2;

const FILLABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="listbox"]',
].join(',');

/** Count fillable controls in this document (or a provided root). */
export function formControlScore(doc: ParentNode = document): number {
  try {
    return doc.querySelectorAll(FILLABLE_SELECTOR).length;
  } catch {
    return 0;
  }
}

/**
 * Frames that may serialize DOM / run plan steps.
 * Top frame always can; child frames only when they look like a form surface.
 */
export function isOakDomFrame(): boolean {
  if (window === window.top) return true;
  return formControlScore() >= MIN_CHILD_FORM_CONTROLS;
}

/** Overlay sidebar: top frame only (pipeline still selects the richest form frame). */
export function shouldMountOakUi(): boolean {
  return window === window.top;
}
