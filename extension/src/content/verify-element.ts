import { resolveElementByNodeId } from './element-resolver';

export interface VerifyResult {
  ok: boolean;
  element: Element | null;
  matchedLabel?: string;
  matchedRole?: string;
  error?: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pushLabel(labels: string[], value: string | null | undefined): void {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (text) labels.push(text);
}

/** Field titles often live on siblings/ancestors, not on the control itself (e.g. file "Attach"). */
function ancestorFieldLabels(el: Element): string[] {
  const labels: string[] = [];
  let node: Element | null = el.parentElement;
  let depth = 0;

  while (node && depth < 7) {
    pushLabel(labels, node.getAttribute('aria-label'));

    for (const child of Array.from(node.children)) {
      if (child === el || child.contains(el)) continue;
      const tag = child.tagName.toUpperCase();
      if (!/^(LABEL|LEGEND|H1|H2|H3|H4|H5|H6|P|SPAN|STRONG|DIV|DT|DD)$/.test(tag)) {
        continue;
      }
      const html = child as HTMLElement;
      const hasNestedControl = Boolean(child.querySelector('input, select, textarea, button, a'));
      if (hasNestedControl && tag !== 'LABEL' && tag !== 'LEGEND') continue;

      const raw = (html.innerText || html.textContent || '').trim();
      if (!raw || raw.length > 240) continue;
      const firstLine = raw.split('\n').map((l) => l.trim()).find(Boolean);
      pushLabel(labels, firstLine);
    }

    node = node.parentElement;
    depth += 1;
  }

  return labels;
}

function labelCandidates(el: Element): string[] {
  const html = el as HTMLElement;
  const primary: string[] = [];
  const own: string[] = [];

  pushLabel(primary, html.getAttribute?.('aria-label'));

  const labelledBy = html.getAttribute?.('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const ref = el.ownerDocument?.getElementById(id);
      pushLabel(primary, ref?.textContent);
    }
  }

  if (html.id) {
    const forLabel = el.ownerDocument?.querySelector(`label[for="${CSS.escape(html.id)}"]`);
    pushLabel(primary, forLabel?.textContent);
  }

  const wrappingLabel = html.closest?.('label');
  if (wrappingLabel) {
    pushLabel(primary, wrappingLabel.textContent);
  }

  pushLabel(primary, html.getAttribute?.('placeholder'));
  pushLabel(primary, html.getAttribute?.('name'));

  const fieldset = html.closest?.('fieldset');
  pushLabel(primary, fieldset?.querySelector?.('legend')?.textContent);

  const prev = html.previousElementSibling;
  if (prev && /^(LABEL|SPAN|P|DIV|LEGEND|STRONG)$/i.test(prev.tagName)) {
    pushLabel(primary, (prev as HTMLElement).innerText || prev.textContent);
  }

  for (const label of ancestorFieldLabels(el)) {
    pushLabel(primary, label);
  }

  const ownText = (html.innerText || html.textContent || '').trim();
  if (ownText && ownText.length < 200) own.push(ownText);

  // Keep control chrome text ("Attach", "Select...") last so field titles win.
  return [...new Set([...primary, ...own].filter(Boolean))];
}

function inferRole(el: Element): string {
  const html = el as HTMLElement;
  const explicit = html.getAttribute?.('role');
  if (explicit) return explicit.toLowerCase();

  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';

  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (type === 'file') return 'file';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'submit' || type === 'button' || type === 'image') return 'submit button';
    if (type === 'hidden') return 'hidden';
    if (type === 'tel') return 'tel';
    if (type === 'email') return 'email';
    if (type === 'url') return 'url';
    if (
      html.getAttribute('aria-haspopup') === 'listbox' ||
      html.getAttribute('aria-autocomplete') === 'list' ||
      (html.hasAttribute('aria-expanded') && html.hasAttribute('aria-controls')) ||
      /\bselect__input\b/i.test(typeof html.className === 'string' ? html.className : '')
    ) {
      return 'combobox';
    }
    return 'textbox';
  }

  if (html.isContentEditable) return 'textbox';
  if (html.getAttribute?.('aria-haspopup') === 'listbox') return 'combobox';
  return tag;
}

function roleMatches(expected: string, actual: string, el: Element): boolean {
  const exp = normalize(expected);
  const act = normalize(actual);
  if (!exp) return true;
  if (exp === act) return true;

  const aliases: Record<string, string[]> = {
    textbox: ['textbox', 'text', 'input', 'searchbox', 'email', 'tel', 'url', 'spinbutton'],
    spinbutton: ['spinbutton', 'textbox', 'text', 'input', 'number'],
    // Greenhouse select__input often looks like a textbox to the planner.
    combobox: ['combobox', 'select', 'listbox', 'dropdown', 'textbox', 'text', 'input', 'searchbox'],
    file: ['file', 'upload'],
    radio: ['radio', 'radiogroup'],
    checkbox: ['checkbox'],
    button: ['button'],
    'submit button': ['submit button', 'button', 'submit'],
    textarea: ['textarea', 'textbox', 'text', 'input'],
  };

  for (const [canonical, list] of Object.entries(aliases)) {
    if (list.includes(exp) && list.includes(act)) return true;
    if (exp.includes(canonical) && list.includes(act)) return true;
  }

  if (exp.includes('submit') && (act === 'button' || act === 'submit button')) {
    const type = (el as HTMLInputElement).type?.toLowerCase?.();
    const text = normalize((el as HTMLElement).innerText || el.textContent || '');
    if (type === 'submit' || text.includes('submit')) return true;
  }

  return act.includes(exp) || exp.includes(act);
}

function labelMatches(expected: string, candidates: string[]): boolean {
  const exp = normalize(expected);
  if (!exp) return true;
  const expBare = exp.replace(/[?*]+$/g, '').trim();
  return candidates.some((c) => {
    const n = normalize(c).replace(/[?*]+$/g, '').trim();
    if (n === exp || n === expBare || n.includes(expBare) || expBare.includes(n)) return true;
    // Plans often truncate long Greenhouse labels; require a long shared prefix.
    const prefixLen = Math.min(72, expBare.length, n.length);
    return prefixLen >= 40 && n.slice(0, prefixLen) === expBare.slice(0, prefixLen);
  });
}

export function verifyElementByPlan(
  elementIndex: number,
  expectedLabel: string | null,
  expectedRole: string | null,
): VerifyResult {
  const el = resolveElementByNodeId(elementIndex);
  if (!el) {
    return {
      ok: false,
      element: null,
      error: `Element not found for index ${elementIndex}`,
    };
  }

  const matchedRole = inferRole(el);
  const candidates = labelCandidates(el);
  const matchedLabel = candidates[0] || '';

  if (expectedRole && !roleMatches(expectedRole, matchedRole, el)) {
    return {
      ok: false,
      element: el,
      matchedLabel,
      matchedRole,
      error: `Role mismatch at ${elementIndex}: expected "${expectedRole}", got "${matchedRole}"`,
    };
  }

  if (expectedLabel && !labelMatches(expectedLabel, candidates)) {
    return {
      ok: false,
      element: el,
      matchedLabel,
      matchedRole,
      error: `Label mismatch at ${elementIndex}: expected "${expectedLabel}", got "${matchedLabel || '(none)'}"`,
    };
  }

  return {
    ok: true,
    element: el,
    matchedLabel,
    matchedRole,
  };
}

export function inferElementRole(el: Element): string {
  return inferRole(el);
}
