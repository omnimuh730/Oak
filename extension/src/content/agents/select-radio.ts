import { inferElementRole } from '../verify-element';
import { selectComboboxOption } from './select-combobox';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionLabel(el: Element): string {
  const html = el as HTMLElement;
  return (
    html.getAttribute('aria-label') ||
    html.getAttribute('value') ||
    (html instanceof HTMLInputElement ? html.value : '') ||
    html.innerText ||
    html.textContent ||
    ''
  ).trim();
}

export async function selectRadioElement(el: Element, value: string | null): Promise<string> {
  const html = el as HTMLElement;
  html.scrollIntoView({ block: 'center', behavior: 'auto' });

  const role = inferElementRole(el);
  if ((role === 'combobox' || html.getAttribute('aria-haspopup') === 'listbox') && value) {
    return selectComboboxOption(el, value);
  }

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    if (!el.checked) el.click();
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return optionLabel(el) || el.value || 'checked';
  }

  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    if (!el.checked) el.click();
    return String(el.checked);
  }

  const root = html.closest('fieldset, [role="radiogroup"], form') || html.parentElement || document;
  const radios = Array.from(root.querySelectorAll('input[type="radio"]'));
  if (radios.length && value) {
    const target = radios.find((radio) => {
      const label = optionLabel(radio);
      const n = normalize(value);
      return (
        normalize(label) === n ||
        normalize((radio as HTMLInputElement).value) === n ||
        normalize(label).includes(n)
      );
    });
    if (!target) throw new Error(`No radio option matching "${value}"`);
    (target as HTMLInputElement).click();
    return optionLabel(target);
  }

  if (value) {
    return selectComboboxOption(el, value);
  }

  html.click();
  return optionLabel(el) || 'clicked';
}
