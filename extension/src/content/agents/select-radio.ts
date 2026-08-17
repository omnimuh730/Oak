import { inferElementRole } from '../verify-element';
import { oakDebugLog } from '../debug-log';
import { findAssociatedCombobox, findComboboxForOption } from './enhanced-select';
import { fillNativeSelect } from './native-select';
import { selectComboboxOption } from './select-combobox';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionLabel(el: Element): string {
  const html = el as HTMLElement;
  const id = html.id;
  const byFor =
    id && html.ownerDocument
      ? html.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
      : null;
  const wrapping = html.closest('label')?.textContent;
  return (
    html.getAttribute('aria-label') ||
    byFor ||
    wrapping ||
    html.getAttribute('value') ||
    (html instanceof HTMLInputElement ? html.value : '') ||
    html.innerText ||
    html.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function labelsMatch(option: Element, value: string): boolean {
  const n = normalize(value);
  if (!n) return false;
  const label = normalize(optionLabel(option));
  const rawValue =
    option instanceof HTMLInputElement ? normalize(option.value) : '';
  return label === n || rawValue === n || label.includes(n) || n.includes(label);
}

function isBooleanIntent(value: string): boolean {
  return /^(true|yes|1|on|checked|false|no|0|off|unchecked)$/i.test(value.trim());
}

function wantChecked(value: string): boolean {
  return /^(true|yes|1|on|checked)$/i.test(value.trim());
}

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return Boolean(el.offsetParent);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function findDisplayedOption(
  listbox: Element | null,
  value: string,
): HTMLElement | null {
  if (!listbox) return null;
  const nodes = Array.from(listbox.querySelectorAll('[role="option"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node),
  );
  return nodes.find((node) => labelsMatch(node, value)) || null;
}

function groupRoot(el: HTMLElement): ParentNode {
  return (
    el.closest(
      'fieldset, [role="group"], [role="radiogroup"], [class*="Field"], [class*="field"], td, th, form',
    ) ||
    el.parentElement ||
    el.ownerDocument ||
    document
  );
}

function findChoiceInGroup(
  root: ParentNode,
  value: string,
  kind: 'checkbox' | 'radio',
): HTMLInputElement | null {
  const nodes = Array.from(root.querySelectorAll(`input[type="${kind}"]`));
  const match = nodes.find((node) => labelsMatch(node, value));
  return match instanceof HTMLInputElement ? match : null;
}

function findAriaChoice(root: ParentNode, value: string): HTMLElement | null {
  const nodes = Array.from(
    root.querySelectorAll('[role="checkbox"], [role="radio"]'),
  ).filter((node): node is HTMLElement => node instanceof HTMLElement);
  return nodes.find((node) => labelsMatch(node, value)) || null;
}

function ensureChecked(el: HTMLInputElement): string {
  if (!el.checked) el.click();
  if (!el.checked) {
    el.checked = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return optionLabel(el) || el.value || 'checked';
}

/**
 * Select a radio/checkbox option by boolean intent or visible option label.
 * Supports native inputs and ARIA role=checkbox/radio widgets.
 */
export async function selectRadioElement(
  el: Element,
  value: string | null,
): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: 'center', behavior: 'auto' });

  const role = inferElementRole(el);
  if (el instanceof HTMLSelectElement && value) {
    const combo = findAssociatedCombobox(el);
    // #region agent log
    oakDebugLog('D', 'select-radio.ts:nativeSelect', 'select_radio native select', {
      hasCombo: Boolean(combo && combo !== el),
      comboTag: combo && combo !== el ? combo.tagName : '',
      optionCount: el.options.length,
      intendedLen: value.trim().length,
    });
    // #endregion
    if (combo && combo !== el) return selectComboboxOption(combo, value);
    return fillNativeSelect(el, value);
  }
  if ((role === 'combobox' || html.getAttribute('aria-haspopup') === 'listbox') && value) {
    return selectComboboxOption(el, value);
  }

  const intended = value?.trim() || '';

  // Planner often targets role=option nodes for custom dropdowns — drive the parent combobox.
  const explicitAriaRole = (html.getAttribute('role') || '').toLowerCase();
  if (explicitAriaRole === 'option' || el instanceof HTMLOptionElement) {
    const label = intended || optionLabel(html);

    if (el instanceof HTMLOptionElement) {
      const select = el.closest('select');
      if (select instanceof HTMLSelectElement) {
        const combo = findAssociatedCombobox(select);
        if (combo && label) return selectComboboxOption(combo, label);
        select.value = el.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return optionLabel(el) || label;
      }
    }

    const combo = findComboboxForOption(html);
    // #region agent log
    oakDebugLog('A', 'select-radio.ts:option', 'option selection path', {
      hasCombo: Boolean(combo),
      comboTag: combo?.tagName || '',
      comboRole: (combo?.getAttribute('role') || '').toLowerCase(),
      optionDisplayed: isDisplayed(html),
      intendedLen: label.length,
      intendedPreview: /^(yes|no)$/i.test(label) ? label : undefined,
    });
    // #endregion
    if (combo && label) return selectComboboxOption(combo, label);

    const visible = findDisplayedOption(html.closest('[role="listbox"]'), label);
    if (visible) {
      visible.click();
      return optionLabel(visible) || label;
    }
    if (isDisplayed(html)) {
      html.click();
      return optionLabel(html) || label;
    }
    throw new Error(
      `Dropdown option "${label}" is not open — no combobox trigger found`,
    );
  }

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    if (intended && !isBooleanIntent(intended) && !labelsMatch(el, intended)) {
      const grouped = findChoiceInGroup(groupRoot(html), intended, 'radio');
      if (grouped) return ensureChecked(grouped);
      throw new Error(`No radio option matching "${intended}"`);
    }
    return ensureChecked(el);
  }

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    if (intended && !isBooleanIntent(intended)) {
      if (labelsMatch(el, intended)) return ensureChecked(el);
      const grouped = findChoiceInGroup(groupRoot(html), intended, 'checkbox');
      if (grouped) return ensureChecked(grouped);
      throw new Error(`No checkbox option matching "${intended}"`);
    }
    const check = !intended || wantChecked(intended);
    if (el.checked !== check) el.click();
    return String(el.checked);
  }

  // ARIA checkbox/radio without native input
  if ((explicitAriaRole === 'checkbox' || explicitAriaRole === 'radio') && intended) {
    if (isBooleanIntent(intended) || labelsMatch(html, intended)) {
      const pressed =
        html.getAttribute('aria-checked') === 'true' ||
        html.getAttribute('aria-pressed') === 'true';
      if (!pressed) html.click();
      return optionLabel(html) || 'checked';
    }
  }

  // Custom choice buttons: the planned node is the option to activate.
  if (el instanceof HTMLButtonElement && intended && labelsMatch(html, intended)) {
    html.click();
    return optionLabel(html) || intended;
  }

  if (intended) {
    const root = groupRoot(html);
    const checkbox = findChoiceInGroup(root, intended, 'checkbox');
    if (checkbox) return ensureChecked(checkbox);
    const radio = findChoiceInGroup(root, intended, 'radio');
    if (radio) return ensureChecked(radio);
    const aria = findAriaChoice(root, intended);
    if (aria) {
      aria.click();
      return optionLabel(aria) || intended;
    }
  }

  const root = groupRoot(html);
  const radios = Array.from(root.querySelectorAll('input[type="radio"]'));
  if (radios.length && intended) {
    const target = findChoiceInGroup(root, intended, 'radio');
    if (!target) throw new Error(`No radio option matching "${intended}"`);
    return ensureChecked(target);
  }

  if (intended) {
    return selectComboboxOption(el, intended);
  }

  html.click();
  return optionLabel(el) || 'clicked';
}
