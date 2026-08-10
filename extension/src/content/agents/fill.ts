import { selectComboboxOption } from './select-combobox';

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
    return fillSelect(el, value);
  }

  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      const shouldCheck = /^(true|yes|1|on|checked)$/i.test(value);
      if (el.checked !== shouldCheck) el.click();
      return String(el.checked);
    }
    const role = html.getAttribute('role');
    if (role === 'combobox' || html.getAttribute('aria-haspopup') === 'listbox') {
      return selectComboboxOption(el, value);
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

  const role = html.getAttribute('role');
  if (role === 'combobox' || html.getAttribute('aria-haspopup') === 'listbox') {
    return selectComboboxOption(el, value);
  }

  throw new Error(`Unsupported fill target <${el.tagName.toLowerCase()}>`);
}
