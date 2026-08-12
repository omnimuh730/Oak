import { MSG } from '../../types';
import { isChoiceSelected, isChoiceWidget } from './choice-state';
import { readControlValue } from './read-control-value';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeLoose(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}+]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function optionOwnLabel(el: Element): string {
  const html = el as HTMLElement;
  return (
    html.getAttribute('aria-label') ||
    html.getAttribute('title') ||
    (el instanceof HTMLOptionElement ? el.label || el.text : '') ||
    html.innerText ||
    html.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function isSelectedOption(el: Element): boolean {
  if (el instanceof HTMLOptionElement) return el.selected;
  const html = el as HTMLElement;
  if (html.getAttribute('aria-selected') === 'true') return true;
  if (html.getAttribute('aria-checked') === 'true') return true;
  if (html.classList.contains('selected') || html.classList.contains('is-selected')) {
    return true;
  }
  return false;
}

function safePreview(text: string): string {
  const n = String(text || '').replace(/\s+/g, ' ').trim();
  if (/^(true|yes|no|false|1|0|on|off|checked|unchecked|\d+\+?)$/i.test(n)) return n;
  return `len=${n.length}`;
}

function elementSnapshot(el: Element): Record<string, unknown> {
  const html = el as HTMLElement;
  const input = el instanceof HTMLInputElement ? el : null;
  return {
    tag: el.tagName,
    role: (html.getAttribute?.('role') || '').toLowerCase(),
    type: input?.type || '',
    checked: input ? input.checked : null,
    ariaChecked: html.getAttribute?.('aria-checked'),
    ariaPressed: html.getAttribute?.('aria-pressed'),
    ariaSelected: html.getAttribute?.('aria-selected'),
    classHasSelected:
      html.classList?.contains('selected') || html.classList?.contains('is-selected') || false,
  };
}

function sendAgentLog(payload: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({ type: MSG.DEBUG_LOG, payload });
  } catch {
    /* ignore */
  }
}

function debugAlreadyFilled(
  hypothesisId: string,
  branch: string,
  matched: boolean,
  current: string,
  intended: string,
  el: Element,
): { matched: boolean; current: string } {
  // #region agent log
  sendAgentLog({
    sessionId: '30bd90',
    hypothesisId,
    location: 'already-filled.ts:controlAlreadyMatches',
    message: 'already-match decision',
    data: {
      branch,
      matched,
      intended: safePreview(intended),
      current: safePreview(current),
      ...elementSnapshot(el),
    },
    timestamp: Date.now(),
  });
  // #endregion
  return { matched, current };
}

/** True when the live control already shows the intended answer (autofill / prior fill). */
export function controlAlreadyMatches(
  el: Element,
  intended: string | null | undefined,
  opts?: { fileName?: string | null },
): { matched: boolean; current: string } {
  if (intended == null || !String(intended).trim()) {
    return debugAlreadyFilled(
      'A',
      'empty-intended',
      false,
      readControlValue(el),
      String(intended ?? ''),
      el,
    );
  }

  const intendedStr = String(intended);
  const role = ((el as HTMLElement).getAttribute?.('role') || '').toLowerCase();
  // role=option always "contains" its own label — only count as filled when selected.
  if (role === 'option' || el instanceof HTMLOptionElement) {
    const label = optionOwnLabel(el);
    const want = normalize(intendedStr);
    const have = normalize(label);
    const labelMatches =
      Boolean(have) && (have === want || have.includes(want) || want.includes(have));
    const selected = isSelectedOption(el);
    return debugAlreadyFilled(
      'E',
      selected && labelMatches ? 'option-selected' : 'option-unselected',
      selected && labelMatches,
      selected ? label : '',
      intendedStr,
      el,
    );
  }

  const current = readControlValue(el);

  if (el instanceof HTMLInputElement && el.type === 'file') {
    if (!current) {
      return debugAlreadyFilled('A', 'file-empty', false, current, intendedStr, el);
    }
    const want = opts?.fileName?.trim();
    if (!want) {
      return debugAlreadyFilled('A', 'file-any', true, current, intendedStr, el);
    }
    const matched =
      normalize(current) === normalize(want) ||
      normalize(current).includes(normalize(want));
    return debugAlreadyFilled('A', 'file-name', matched, current, intendedStr, el);
  }

  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const booleanLike =
      /^(true|yes|1|on|checked|false|no|0|off|unchecked)$/i.test(intendedStr.trim());
    if (booleanLike) {
      const wantChecked = /^(true|yes|1|on|checked)$/i.test(intendedStr.trim());
      return debugAlreadyFilled(
        'D',
        'native-bool',
        el.checked === wantChecked,
        String(el.checked),
        intendedStr,
        el,
      );
    }
    const id = el.id;
    const byFor =
      id && el.ownerDocument
        ? el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
        : null;
    const label = normalize(
      (
        el.getAttribute('aria-label') ||
        byFor ||
        el.closest('label')?.textContent ||
        el.value ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const want = normalize(intendedStr);
    const labelMatches = Boolean(
      label && (label === want || label.includes(want) || want.includes(label)),
    );
    return debugAlreadyFilled(
      'D',
      'native-label',
      labelMatches && el.checked,
      el.checked ? label || String(el.checked) : '',
      intendedStr,
      el,
    );
  }

  if (isChoiceWidget(el)) {
    const selected = isChoiceSelected(el);
    const label = optionOwnLabel(el);
    const want = normalize(intendedStr);
    const have = normalize(label);
    const labelMatches =
      Boolean(have) && (have === want || have.includes(want) || want.includes(have));
    return debugAlreadyFilled(
      'B',
      selected && labelMatches ? 'choice-selected' : 'choice-unselected',
      Boolean(selected && labelMatches),
      selected ? label : '',
      intendedStr,
      el,
    );
  }

  const want = normalize(intendedStr);
  const have = normalize(current);
  if (!have) {
    return debugAlreadyFilled('A', 'generic-empty', false, current, intendedStr, el);
  }
  if (have === want) {
    return debugAlreadyFilled('B', 'generic-exact', true, current, intendedStr, el);
  }

  const wantLoose = normalizeLoose(intendedStr);
  const haveLoose = normalizeLoose(current);
  if (wantLoose && haveLoose && wantLoose === haveLoose) {
    return debugAlreadyFilled('B', 'generic-loose', true, current, intendedStr, el);
  }

  if (want.length >= 2 && (have.startsWith(want) || want.startsWith(have))) {
    return debugAlreadyFilled('C', 'generic-prefix', true, current, intendedStr, el);
  }

  return debugAlreadyFilled('A', 'generic-no-match', false, current, intendedStr, el);
}
