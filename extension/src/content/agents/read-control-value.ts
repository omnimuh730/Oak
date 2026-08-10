const PLACEHOLDER_VALUES = new Set(['', 'select...', 'select', 'choose...', 'choose']);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_VALUES.has(normalize(text));
}

/**
 * React-select and similar widgets keep the chosen label in a sibling node;
 * the combobox <input> value is often empty after selection.
 */
function readComboboxDisplayValue(el: Element): string {
  const html = el as HTMLElement;
  const roots: Element[] = [];
  const closestControl = html.closest(
    '[class*="control"], [class*="Control"], [class*="select"], [class*="Select"]',
  );
  if (closestControl) roots.push(closestControl);
  if (html.parentElement) roots.push(html.parentElement);
  if (html.parentElement?.parentElement) roots.push(html.parentElement.parentElement);

  const valueSelectors = [
    '[class*="single-value"]',
    '[class*="singleValue"]',
    '[class*="multi-value__label"]',
    '[class*="multiValue"]',
    '[data-value]',
  ];

  for (const root of roots) {
    const parts: string[] = [];
    for (const selector of valueSelectors) {
      for (const node of Array.from(root.querySelectorAll(selector))) {
        if (node.contains(el) && node !== el) continue;
        const text = ((node as HTMLElement).innerText || node.textContent || '').trim();
        if (!text || isPlaceholder(text)) continue;
        if (!parts.includes(text)) parts.push(text);
      }
    }
    if (parts.length) return parts.join(', ');
  }

  const aria = html.getAttribute('aria-valuetext') || html.getAttribute('data-value');
  if (aria && !isPlaceholder(aria)) return aria.trim();

  return '';
}

/** Read the user-visible value of a form control for validate / reporting. */
export function readControlValue(el: Element | null): string {
  if (!el) return '';

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return String(el.checked);
    if (el.type === 'file') {
      return Array.from(el.files ?? [])
        .map((f) => f.name)
        .join(', ');
    }

    const role = (el.getAttribute('role') || '').toLowerCase();
    const isCombobox =
      role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-haspopup') === 'true';
    if (isCombobox) {
      const displayed = readComboboxDisplayValue(el);
      if (displayed) return displayed;
    }

    return el.value;
  }

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;

  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
    const displayed = readComboboxDisplayValue(el);
    if (displayed) return displayed;
  }

  return ((el as HTMLElement).innerText || el.textContent || '').trim();
}
