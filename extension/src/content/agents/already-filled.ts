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

/** True when the live control already shows the intended answer (autofill / prior fill). */
export function controlAlreadyMatches(
  el: Element,
  intended: string | null | undefined,
  opts?: { fileName?: string | null },
): { matched: boolean; current: string } {
  if (intended == null || !String(intended).trim()) {
    return { matched: false, current: readControlValue(el) };
  }

  const role = ((el as HTMLElement).getAttribute?.('role') || '').toLowerCase();
  // role=option always "contains" its own label — only count as filled when selected.
  if (role === 'option' || el instanceof HTMLOptionElement) {
    const label = optionOwnLabel(el);
    const want = normalize(String(intended));
    const have = normalize(label);
    const labelMatches =
      Boolean(have) && (have === want || have.includes(want) || want.includes(have));
    const selected = isSelectedOption(el);
    return {
      matched: selected && labelMatches,
      current: selected ? label : '',
    };
  }

  const current = readControlValue(el);

  if (el instanceof HTMLInputElement && el.type === 'file') {
    if (!current) return { matched: false, current };
    const want = opts?.fileName?.trim();
    if (!want) return { matched: true, current };
    return {
      matched:
        normalize(current) === normalize(want) ||
        normalize(current).includes(normalize(want)),
      current,
    };
  }

  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const intendedStr = String(intended).trim();
    const booleanLike =
      /^(true|yes|1|on|checked|false|no|0|off|unchecked)$/i.test(intendedStr);
    if (booleanLike) {
      const wantChecked = /^(true|yes|1|on|checked)$/i.test(intendedStr);
      return { matched: el.checked === wantChecked, current: String(el.checked) };
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
    return {
      matched: labelMatches && el.checked,
      current: el.checked ? label || String(el.checked) : '',
    };
  }

  const want = normalize(String(intended));
  const have = normalize(current);
  if (!have) return { matched: false, current };
  if (have === want) return { matched: true, current };

  const wantLoose = normalizeLoose(String(intended));
  const haveLoose = normalizeLoose(current);
  if (wantLoose && haveLoose && wantLoose === haveLoose) {
    return { matched: true, current };
  }

  if (want.length >= 2 && (have.startsWith(want) || want.startsWith(have))) {
    return { matched: true, current };
  }

  return { matched: false, current };
}
