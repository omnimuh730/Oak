import {
  findAssociatedCombobox,
  isEnhancedSelect,
  resolveDropdownInteractionTarget,
} from './enhanced-select';
import { selectComboboxOption } from './select-combobox';
import { selectRadioElement } from './select-radio';

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
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } catch {
    // ignore
  }
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

async function fillSelect(el: HTMLSelectElement, value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  let matched: HTMLOptionElement | null = null;
  for (const option of Array.from(el.options)) {
    const label = (option.textContent || option.label || '').trim();
    const optValue = option.value.trim();
    if (
      label.toLowerCase() === normalized ||
      optValue.toLowerCase() === normalized ||
      label.toLowerCase().includes(normalized)
    ) {
      matched = option;
      break;
    }
  }
  if (!matched) {
    throw new Error(`No select option matching "${value}"`);
  }
  el.value = matched.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return matched.textContent?.trim() || matched.value;
}

export async function fillElement(el: Element, value: string): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: 'center', behavior: 'auto' });
  html.focus?.();

  if (el instanceof HTMLSelectElement) {
    const enhanced = isEnhancedSelect(el);
    const combo = findAssociatedCombobox(el);
    // #region agent log
    fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e43d4'},body:JSON.stringify({sessionId:'4e43d4',runId:'dropdown-v3',hypothesisId:'F',location:'fill.ts:select',message:'Select fill routing',data:{selectId:el.id||null,optionCount:el.options.length,enhanced,hasCombo:Boolean(combo),comboTag:combo?.tagName||null,comboId:combo?.id||null,valueLen:value.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (enhanced && combo) {
      return selectComboboxOption(combo, value);
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
    if (looksLikeCombobox(html)) {
      const target = resolveDropdownInteractionTarget(html);
      // #region agent log
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e43d4'},body:JSON.stringify({sessionId:'4e43d4',runId:'dropdown-v3',hypothesisId:'F',location:'fill.ts:comboboxInput',message:'Combobox input remapped',data:{fromTag:html.tagName,fromId:html.id||null,fromAriaHidden:html.getAttribute('aria-hidden'),toTag:target.tagName,toId:target.id||null,remapped:target!==html,valueLen:value.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return selectComboboxOption(target, value);
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

  if (looksLikeCombobox(html)) {
    const target = resolveDropdownInteractionTarget(html);
    // #region agent log
    fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e43d4'},body:JSON.stringify({sessionId:'4e43d4',runId:'dropdown-v3',hypothesisId:'F',location:'fill.ts:comboboxEl',message:'Combobox element remapped',data:{fromTag:html.tagName,fromId:html.id||null,toTag:target.tagName,toId:target.id||null,remapped:target!==html,valueLen:value.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return selectComboboxOption(target, value);
  }

  throw new Error(`Unsupported fill target <${el.tagName.toLowerCase()}>`);
}
