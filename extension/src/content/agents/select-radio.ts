import { agentDebugLog } from '../debug-log';
import { inferElementRole } from '../verify-element';
import { findAssociatedCombobox, isEnhancedSelect } from './enhanced-select';
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
  if ((role === 'combobox' || html.getAttribute('aria-haspopup') === 'listbox') && value) {
    return selectComboboxOption(el, value);
  }

  const intended = value?.trim() || '';

  // #region agent log
  agentDebugLog({
    runId: 'option-v1',
    hypothesisId: 'J',
    location: 'select-radio.ts:enter',
    message: 'Choice control select',
    data: {
      tag: html.tagName,
      type: el instanceof HTMLInputElement ? el.type : null,
      role,
      id: html.id || null,
      ariaRole: html.getAttribute('role'),
      valueLen: intended.length,
      valuePreview: intended.slice(0, 60),
      booleanIntent: intended ? isBooleanIntent(intended) : null,
    },
  });
  // #endregion

  // Planner often targets role=option nodes for custom dropdowns — drive the parent combobox.
  const explicitAriaRole = (html.getAttribute('role') || '').toLowerCase();
  if (explicitAriaRole === 'option' || el instanceof HTMLOptionElement) {
    const label = intended || optionLabel(html);

    if (el instanceof HTMLOptionElement) {
      const select = el.closest('select');
      if (select instanceof HTMLSelectElement) {
        const combo = findAssociatedCombobox(select);
        // #region agent log
        agentDebugLog({
          runId: 'option-v1',
          hypothesisId: 'J',
          location: 'select-radio.ts:optionNative',
          message: 'Native option routed',
          data: {
            selectId: select.id || null,
            enhanced: isEnhancedSelect(select),
            hasCombo: Boolean(combo),
            comboTag: combo?.tagName || null,
            labelPreview: label.slice(0, 60),
          },
        });
        // #endregion
        if (combo && label) return selectComboboxOption(combo, label);
        select.value = el.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return optionLabel(el) || label;
      }
    }

    const listbox = html.closest('[role="listbox"]');
    const field =
      (listbox?.parentElement as HTMLElement | null) ||
      html.parentElement ||
      html;
    const nearSelect = field.querySelector('select');
    const comboFromSelect =
      nearSelect instanceof HTMLSelectElement
        ? findAssociatedCombobox(nearSelect)
        : null;
    const combo =
      comboFromSelect ||
      (field.querySelector(
        '[role="combobox"]:not([aria-hidden="true"])',
      ) as HTMLElement | null) ||
      (field.parentElement?.querySelector(
        '[role="combobox"]:not([aria-hidden="true"])',
      ) as HTMLElement | null);
    // #region agent log
    agentDebugLog({
      runId: 'option-v1',
      hypothesisId: 'J',
      location: 'select-radio.ts:option',
      message: 'Option routed to combobox',
      data: {
        optionId: html.id || null,
        labelPreview: label.slice(0, 60),
        hasCombo: Boolean(combo),
        comboTag: combo?.tagName || null,
        comboId: combo?.id || null,
        viaSelect: Boolean(comboFromSelect),
      },
    });
    // #endregion
    if (combo && label) return selectComboboxOption(combo, label);
    html.click();
    return optionLabel(html) || label;
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
      // #region agent log
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e43d4'},body:JSON.stringify({sessionId:'4e43d4',runId:'checkbox-v1',hypothesisId:'I',location:'select-radio.ts:checkboxGroup',message:'Checkbox group label match',data:{intendedPreview:intended.slice(0,60),selfMatch:labelsMatch(el,intended),found:Boolean(grouped),foundId:grouped?.id||null,foundLabel:(grouped?optionLabel(grouped):null)?.slice(0,60)||null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
