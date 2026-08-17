import { oakDebugLog } from '../debug-log';
import {
  findAssociatedCombobox,
  isEnhancedSelect,
  resolveDropdownInteractionTarget,
} from './enhanced-select';
import { fillNativeSelect } from './native-select';
import { selectComboboxOption } from './select-combobox';
import { selectRadioElement } from './select-radio';
import { waitMs } from './wait';

function countRealSelectOptions(select: HTMLSelectElement): number {
  return Array.from(select.options).filter((option) => {
    const label = (option.textContent || option.label || '').trim();
    const value = option.value.trim();
    if (!value && !label) return false;
    const n = label.toLowerCase().replace(/^[—\-–•·.\s|]+/, '');
    if (!n) return Boolean(value);
    if (/^(select|choose|pick|make a selection)/i.test(n)) return false;
    return true;
  }).length;
}

/** ARIA / structural combobox signals (no vendor class allowlists). */
function looksLikeCombobox(el: HTMLElement): boolean {
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'combobox' || role === 'listbox') return true;
  if (el.getAttribute('aria-haspopup') === 'listbox') return true;
  if (el.getAttribute('aria-autocomplete') === 'list') return true;
  if (el.hasAttribute('aria-expanded') && el.hasAttribute('aria-controls')) return true;
  return false;
}

async function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  el.focus();
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const protoDesc = Object.getOwnPropertyDescriptor(proto, 'value');
  const ownDesc = Object.getOwnPropertyDescriptor(el, 'value');
  const setter = protoDesc?.set;
  const rec = el as unknown as { _valueTracker?: { getValue?: () => string; setValue?: (v: string) => void } };
  if (setter) setter.call(el, text);
  else el.value = text;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } catch {
    // ignore
  }

  const win = el.ownerDocument.defaultView as unknown as {
    jQuery?: (
      sel: string | Element,
    ) => { val: (v: string) => { trigger: (e: string) => void } };
    $?: (
      sel: string | Element,
    ) => { val: (v: string) => { trigger: (e: string) => void } };
    angular?: unknown;
  };
  const jq = win?.jQuery || win?.$;
  let jqueryTriggered = false;
  try {
    if (jq) {
      const chain = jq(el).val(text);
      chain.trigger('input');
      chain.trigger('change');
      jqueryTriggered = true;
    }
  } catch {
    jqueryTriggered = false;
  }

  el.dispatchEvent(new Event('blur', { bubbles: true }));
  const valueLenAfterBlur = String(el.value || '').length;
  await waitMs(50);
  const valueLenLater = String(el.value || '').length;
  const sameNameCount = el.name
    ? el.ownerDocument.querySelectorAll(`[name="${CSS.escape(el.name)}"]`).length
    : 1;
  // #region agent log
  oakDebugLog('J', 'fill.ts:setNativeValue', 'native value after set', {
    type: el instanceof HTMLInputElement ? el.type : 'textarea',
    intendedLen: text.length,
    valueLen: String(el.value || '').length,
    valueLenAfterBlur,
    valueLenLater,
    wiped: valueLenLater === 0 && text.length > 0,
    matched: el.value === text,
    displayed: el.getClientRects().length > 0,
    readOnly: Boolean((el as HTMLInputElement).readOnly),
    required: Boolean(el.required),
    ariaInvalid: el.getAttribute('aria-invalid'),
    inputMode: el.inputMode || '',
    hasPattern: el instanceof HTMLInputElement && Boolean(el.pattern),
    maxLength: el.maxLength,
    hasTracker: Boolean(rec._valueTracker),
    reactKeyCount: Object.keys(el).filter((k) => k.startsWith('__react')).length,
    protoSetter: Boolean(setter),
    ownValueSetter: Boolean(ownDesc?.set),
    sameNameCount,
    hasJquery: Boolean(win?.jQuery),
    hasDollar: Boolean(win?.$),
    hasAngular: Boolean(win?.angular),
    jqueryTriggered,
  });
  // #endregion
}

async function fillSelect(el: HTMLSelectElement, value: string): Promise<string> {
  return fillNativeSelect(el, value);
}

export async function fillElement(
  el: Element,
  value: string,
  fieldHint?: string | null,
): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: 'center', behavior: 'auto' });
  html.focus?.();
  const input = el instanceof HTMLInputElement ? el : null;
  // #region agent log
  oakDebugLog('C', 'fill.ts:fillElement', 'fill target', {
    tag: el.tagName,
    type: input?.type || '',
    role: (html.getAttribute('role') || '').toLowerCase(),
    looksCombo: looksLikeCombobox(html),
    displayed: html.getClientRects().length > 0,
    disabled: Boolean(input?.disabled),
    readOnly: Boolean(input?.readOnly),
    nestedInputs: html.querySelectorAll('input, textarea, select').length,
  });
  // #endregion

  if (el instanceof HTMLSelectElement) {
    const enhanced = isEnhancedSelect(el);
    const combo = findAssociatedCombobox(el);
    // #region agent log
    oakDebugLog('E', 'fill.ts:fillElement', 'select fill path', {
      enhanced,
      hasCombo: Boolean(combo),
      optionCount: el.options.length,
      realOptionCount: countRealSelectOptions(el),
      intendedLen: value.trim().length,
    });
    // #endregion
    if (enhanced && combo && combo !== el) {
      return selectComboboxOption(combo, value, fieldHint);
    }
    return fillSelect(el, value);
  }

  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      // Option labels ("None/Not applicable") must resolve via group matching —
      // boolean-only toggling left required checkbox groups unchecked.
      return selectRadioElement(el, value);
    }
    if (type === 'password' || type === 'hidden' || type === 'file') {
      await setNativeValue(el, value);
      return el.value;
    }
    if (looksLikeCombobox(html)) {
      const target = resolveDropdownInteractionTarget(html);
      return selectComboboxOption(target, value, fieldHint);
    }
    await setNativeValue(el, value);
    return el.value;
  }

  if (el instanceof HTMLTextAreaElement) {
    await setNativeValue(el, value);
    return el.value;
  }

  if (html.isContentEditable) {
    html.textContent = value;
    html.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
    return html.textContent || value;
  }

  const role = (html.getAttribute('role') || '').toLowerCase();
  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLFieldSetElement ||
    role === 'radio' ||
    role === 'checkbox' ||
    role === 'radiogroup' ||
    role === 'group' ||
    role === 'switch'
  ) {
    return selectRadioElement(el, value);
  }

  if (looksLikeCombobox(html)) {
    const target = resolveDropdownInteractionTarget(html);
    return selectComboboxOption(target, value, fieldHint);
  }

  throw new Error(`Unsupported fill target <${el.tagName.toLowerCase()}>`);
}
