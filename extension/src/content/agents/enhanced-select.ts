/**
 * Pair native <select> / nested search inputs with their custom listbox trigger.
 * Vendor-agnostic: ARIA roles + id/sibling structure only.
 */

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return Boolean(el.offsetParent);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function comboboxCandidates(root: ParentNode, exclude?: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('[role="combobox"]')).filter(
    (node): node is HTMLElement => {
      if (!(node instanceof HTMLElement) || node === exclude) return false;
      if (node.getAttribute('aria-hidden') === 'true') return false;
      if (node.closest('[role="listbox"]')) return false;
      return true;
    },
  );
}

/** Prefer comboboxes whose id is clearly paired with the source control id. */
function idLinkedCombobox(
  sourceId: string,
  combos: HTMLElement[],
): HTMLElement | null {
  if (!sourceId) return null;
  const exact = combos.find((el) => el.id === sourceId);
  if (exact) return exact;
  const prefixed = combos.find(
    (el) => el.id.startsWith(`${sourceId}_`) || el.id.startsWith(`${sourceId}-`),
  );
  if (prefixed) return prefixed;
  return (
    combos.find((el) => {
      const controls = el.getAttribute('aria-controls') || '';
      const owns = el.getAttribute('aria-owns') || '';
      return controls.split(/\s+/).includes(sourceId) || owns.split(/\s+/).includes(sourceId);
    }) || null
  );
}

function pickPreferredCombobox(combos: HTMLElement[]): HTMLElement | null {
  if (!combos.length) return null;
  const nonInputs = combos.filter(
    (node) => node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA',
  );
  return (
    nonInputs.find((node) => isDisplayed(node)) ||
    nonInputs[0] ||
    combos.find((node) => isDisplayed(node)) ||
    combos[0] ||
    null
  );
}

/**
 * Resolve the interaction target for a dropdown widget.
 * When the source has an id, only pair with an id-linked combobox (or a sibling
 * in the immediate field cell) — never a distant combobox in a large ancestor.
 */
export function resolveDropdownInteractionTarget(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLSelectElement) {
    return findAssociatedCombobox(el) || el;
  }

  const role = (el.getAttribute('role') || '').toLowerCase();
  const isSearchLike =
    role === 'combobox' &&
    (el instanceof HTMLInputElement || el.getAttribute('aria-hidden') === 'true');

  if (!isSearchLike && role === 'combobox' && isDisplayed(el)) {
    return el;
  }

  // Nested/hidden search input → find sibling trigger via nearby select id or parent.
  const parent = el.parentElement;
  if (parent) {
    const select = parent.querySelector('select');
    if (select instanceof HTMLSelectElement) {
      const linked = findAssociatedCombobox(select);
      if (linked) return linked;
    }
    const local = pickPreferredCombobox(comboboxCandidates(parent, el));
    if (local) return local;
  }

  // One more level (field cell), still avoiding the whole form.
  const grand = parent?.parentElement;
  if (grand) {
    const select = grand.querySelector('select');
    if (select instanceof HTMLSelectElement) {
      const linked = findAssociatedCombobox(select);
      if (linked) return linked;
    }
    const local = pickPreferredCombobox(comboboxCandidates(grand, el));
    if (local && local !== el) return local;
  }

  return el;
}

/** Find the interactive combobox trigger paired with a native <select>. */
export function findAssociatedCombobox(select: HTMLSelectElement): HTMLElement | null {
  // 1) Immediate parent / field cell — strongest structural pairing.
  const nearRoots: HTMLElement[] = [];
  if (select.parentElement) nearRoots.push(select.parentElement);
  if (select.parentElement?.parentElement) {
    nearRoots.push(select.parentElement.parentElement);
  }

  for (const root of nearRoots) {
    const combos = comboboxCandidates(root, select);
    if (select.id) {
      const linked = idLinkedCombobox(select.id, combos);
      if (linked) return linked;
    }
    if (combos.length === 1) return combos[0];
    const preferred = pickPreferredCombobox(combos);
    // Only accept multi-combo near-roots when id-linked; otherwise too ambiguous.
    if (select.id) continue;
    if (preferred) return preferred;
  }

  // 2) Wider search only for id-linked pairs (safe across large address blocks).
  if (select.id) {
    const scope =
      (select.closest(
        'td, th, [class*="Field"], [class*="field"], fieldset, form',
      ) as HTMLElement | null) || select.ownerDocument?.body;
    if (scope) {
      const linked = idLinkedCombobox(select.id, comboboxCandidates(scope, select));
      if (linked) return linked;
    }
  }

  return null;
}

function selectHasRealOptions(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some((option) => {
    const label = (option.textContent || option.label || '').trim();
    const value = option.value.trim();
    if (!value && !label) return false;
    const n = label.toLowerCase().replace(/^[—\-–•·.\s|]+/, '');
    if (!n) return Boolean(value);
    if (/^(select|choose|pick|make a selection)/i.test(n)) return false;
    return true;
  });
}

/** True when the select is backed by a custom dropdown UI rather than the native picker. */
export function isEnhancedSelect(select: HTMLSelectElement): boolean {
  if (findAssociatedCombobox(select)) return true;
  const parent = select.parentElement;
  if (parent?.querySelector('[role="listbox"]') && !isDisplayed(select)) return true;
  if (
    !selectHasRealOptions(select) &&
    parent?.querySelector('[role="listbox"], [role="combobox"]')
  ) {
    return true;
  }
  return false;
}
