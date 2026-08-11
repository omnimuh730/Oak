import { resolveDropdownInteractionTarget } from './enhanced-select';
import { askAiMatchOption } from './match-option-client';
import { readControlValue } from './read-control-value';
import {
  OPTION_SIMILARITY_THRESHOLD,
  bestSimilarityMatch,
  stringSimilarity,
} from './string-similarity';
import { waitMs } from './wait';

/** Delay between keystrokes when appending a typed word. */
const SMOOTH_TYPE_DELAY_MS = 45;
/** Settle time after each typed word so filtered options can render. */
const WORD_SEARCH_SETTLE_MS = 320;
const OPTION_WAIT_MS = 3000;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionText(el: Element): string {
  return ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderOption(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  const stripped = n.replace(/^[—\-–•·.|]+|[—\-–•·.|]+$/g, '').trim();
  if (!stripped) return true;
  return /^(select(\s|$)|choose(\s|$)|pick(\s|$)|make a selection|type to search|please select|no results|no matches|nothing found|no options)/i.test(
    stripped,
  );
}

function isDisplayed(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style) return Boolean(el.offsetParent);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function pointerClick(el: HTMLElement): void {
  const view = el.ownerDocument?.defaultView || window;
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function dismissOpenOverlays(doc: Document, control: HTMLElement): void {
  control.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  doc.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

function collectRefIds(el: HTMLElement): string[] {
  return [el.getAttribute('aria-controls'), el.getAttribute('aria-owns'), el.getAttribute('list')]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
}

function listboxRootsForControl(control: HTMLElement, doc: Document): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const seen = new Set<string>();

  const addIds = (ids: string[]) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = doc.getElementById(id);
      if (node instanceof HTMLElement) roots.push(node);
    }
  };

  addIds(collectRefIds(control));

  // Custom widgets often put aria-owns on a sibling/ancestor container, not the trigger.
  let node: HTMLElement | null = control.parentElement;
  for (let depth = 0; depth < 5 && node; depth++) {
    addIds(collectRefIds(node));
    for (const child of Array.from(node.children)) {
      if (child instanceof HTMLElement) addIds(collectRefIds(child));
    }
    node = node.parentElement;
  }

  return roots;
}

function collectOptionsInRoot(root: ParentNode): HTMLElement[] {
  const selectors = [
    '[role="option"]',
    '[role="listbox"] [role="option"]',
    '[role="listbox"] li',
    'ul[role="listbox"] li',
  ];
  const found = new Set<HTMLElement>();
  for (const selector of selectors) {
    for (const node of Array.from(root.querySelectorAll(selector))) {
      const html = node as HTMLElement;
      if (!isDisplayed(html)) continue;
      const text = optionText(html);
      if (!text || text.length > 200 || isPlaceholderOption(text)) continue;
      found.add(html);
    }
  }
  return Array.from(found);
}

function scoreListbox(listbox: HTMLElement, control: HTMLElement): number {
  const controlRect = control.getBoundingClientRect();
  const boxRect = listbox.getBoundingClientRect();
  if (boxRect.width === 0 && boxRect.height === 0) return Number.POSITIVE_INFINITY;
  return (
    Math.abs(boxRect.left - controlRect.left) + Math.abs(boxRect.top - controlRect.bottom)
  );
}

function pickScopedOptions(control: HTMLElement, doc: Document): HTMLElement[] {
  const owned = listboxRootsForControl(control, doc);
  for (const root of owned) {
    // Owned roots may exist before the menu populates; keep falling through.
    if (!isDisplayed(root) && collectOptionsInRoot(root).length === 0) continue;
    const options = collectOptionsInRoot(root);
    if (options.length) return options;
  }

  const listboxes = Array.from(doc.querySelectorAll('[role="listbox"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node),
  );
  listboxes.sort((a, b) => scoreListbox(a, control) - scoreListbox(b, control));
  for (const listbox of listboxes) {
    const options = collectOptionsInRoot(listbox);
    if (options.length) return options;
  }

  // Last resort: options that share a nearby field container with the control
  // (Greenhouse/react-select sometimes portals options outside aria-controls).
  const container =
    control.closest('fieldset, [role="group"], form, label, div') || control.parentElement;
  if (container) {
    const local = collectOptionsInRoot(container);
    if (local.length) return local;
  }

  return [];
}

async function waitForScopedOptions(
  control: HTMLElement,
  doc: Document,
  maxMs = OPTION_WAIT_MS,
): Promise<HTMLElement[]> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const options = pickScopedOptions(control, doc);
    if (options.length) return options;
    await waitMs(50);
  }
  return pickScopedOptions(control, doc);
}

function findLocalMatch(
  options: HTMLElement[],
  value: string,
): { match: HTMLElement | null; score: number | null; strategy: string } {
  const target = normalize(value);
  if (!target) return { match: null, score: null, strategy: 'empty' };

  const exact = options.find((opt) => normalize(optionText(opt)) === target);
  if (exact) return { match: exact, score: 1, strategy: 'exact' };

  if (target.length <= 3) {
    const tokenExact = options.find((opt) => {
      const tokens = normalize(optionText(opt)).split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.includes(target);
    });
    if (tokenExact) return { match: tokenExact, score: 1, strategy: 'tokenExact' };
  }

  if (target.length >= 4) {
    const prefix = options.find((opt) => {
      const text = normalize(optionText(opt));
      return text.startsWith(target) || text.includes(`${target} `) || text.includes(`${target}+`);
    });
    if (prefix) {
      return {
        match: prefix,
        score: stringSimilarity(value, optionText(prefix)),
        strategy: 'prefix',
      };
    }
  }

  const scored = bestSimilarityMatch(value, options, optionText, OPTION_SIMILARITY_THRESHOLD);
  if (scored) return { match: scored.item, score: scored.score, strategy: 'similarity' };

  let bestBelow: { text: string; score: number } | null = null;
  for (const opt of options) {
    const score = stringSimilarity(value, optionText(opt));
    if (!bestBelow || score > bestBelow.score) bestBelow = { text: optionText(opt), score };
  }
  return {
    match: null,
    score: bestBelow?.score ?? null,
    strategy: bestBelow ? `belowThreshold:${bestBelow.text}` : 'none',
  };
}

function resolveOptionElement(
  options: HTMLElement[],
  label: string,
): HTMLElement | null {
  return (
    options.find((opt) => optionText(opt) === label) ||
    options.find((opt) => normalize(optionText(opt)) === normalize(label)) ||
    null
  );
}

async function focusAndOpenCombobox(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  el.focus?.();
  pointerClick(el);
  await waitMs(80);
  // Clear any leftover filter text so the full option list is visible.
  const input = resolveTypeableInput(el);
  if (input) {
    input.removeAttribute('aria-hidden');
    setInputValue(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitMs(60);
  }
}

function resolveTypeableInput(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  const root = el.parentElement || el;
  const candidates = Array.from(
    root.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea',
    ),
  ).filter((node): node is HTMLInputElement | HTMLTextAreaElement => {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
    const role = (node.getAttribute('role') || '').toLowerCase();
    return (
      role === 'combobox' ||
      node.getAttribute('aria-autocomplete') === 'list' ||
      node.type === 'search' ||
      node.type === 'text'
    );
  });
  return candidates.find((node) => isDisplayed(node as HTMLElement)) || candidates[0] || null;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
}

/** Type the full query string into an already-focused open combobox. */
async function typeQueryIntoOpenCombobox(el: HTMLElement, query: string): Promise<void> {
  const input = resolveTypeableInput(el);
  if (!input) return;
  // Nested search inputs are often aria-hidden until the menu opens.
  input.removeAttribute('aria-hidden');
  input.focus();
  setInputValue(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));

  let built = '';
  for (const ch of query) {
    built += ch;
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }),
    );
    setInputValue(input, built);
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: ch,
        inputType: 'insertText',
      }),
    );
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
    await waitMs(SMOOTH_TYPE_DELAY_MS);
  }
  await waitMs(WORD_SEARCH_SETTLE_MS);
}

async function matchFromCandidates(
  options: HTMLElement[],
  value: string,
  fieldLabel: string | null,
  typedQuery: string | null,
): Promise<{ match: HTMLElement | null; score: number | null; strategy: string }> {
  const local = findLocalMatch(options, value);
  if (local.match) return local;

  if (!options.length) {
    return { match: null, score: local.score, strategy: local.strategy };
  }

  const labels = options.map(optionText);
  const ai = await askAiMatchOption({
    intendedValue: value,
    options: labels,
    fieldLabel,
    typedQuery,
  });

  if (ai.matched_option) {
    const el = resolveOptionElement(options, ai.matched_option);
    if (el) {
      return {
        match: el,
        score: typeof ai.confidence === 'number' ? ai.confidence : 1,
        strategy: 'ai',
      };
    }
  }

  return { match: null, score: local.score, strategy: local.strategy };
}

/**
 * 1) Focus → collect initial candidates → local match → AI match
 * 2) If still unmatched: type one word at a time, wait for filtered list, AI-match again
 */
export async function selectComboboxOption(el: Element, value: string): Promise<string> {
  const requested = el as HTMLElement;
  const html = resolveDropdownInteractionTarget(requested);
  const doc = html.ownerDocument || document;
  const fieldLabel =
    html.getAttribute('aria-label') ||
    requested.getAttribute('aria-label') ||
    (html.id
      ? doc.querySelector(`label[for="${CSS.escape(html.id)}"]`)?.textContent?.trim()
      : null) ||
    (requested.id
      ? doc.querySelector(`label[for="${CSS.escape(requested.id)}"]`)?.textContent?.trim()
      : null) ||
    null;

  dismissOpenOverlays(doc, html);
  await waitMs(40);
  await focusAndOpenCombobox(html);

  let options = await waitForScopedOptions(html, doc);
  if (!options.length) {
    html.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    options = await waitForScopedOptions(html, doc);
  }

  // #region agent log
  fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4e43d4'},body:JSON.stringify({sessionId:'4e43d4',runId:'dropdown-v3',hypothesisId:'F',location:'select-combobox.ts:options',message:'Combobox options after open',data:{requestedTag:requested.tagName,requestedId:requested.id||null,tag:html.tagName,role:html.getAttribute('role'),id:html.id||null,remapped:html!==requested,optionCount:options.length,optionPreview:options.slice(0,8).map(optionText),valueLen:value.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  let { match, score } = await matchFromCandidates(options, value, fieldLabel, null);

  // Word-by-word typing only when initial candidates (local+AI) did not resolve.
  const typeable = resolveTypeableInput(html);
  if (!match && typeable && value.trim().length >= 2) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    let typed = '';

    for (const word of words) {
      typed = typed ? `${typed} ${word}` : word;
      await focusAndOpenCombobox(html);
      await typeQueryIntoOpenCombobox(html, typed);
      options = await waitForScopedOptions(html, doc, 2000);

      const resolved = await matchFromCandidates(options, value, fieldLabel, typed);
      match = resolved.match;
      score = resolved.score;
      if (match) break;
    }
  }

  if (!match) {
    const bestPct =
      score != null
        ? ` (best ${(score * 100).toFixed(1)}% < ${OPTION_SIMILARITY_THRESHOLD * 100}%)`
        : '';
    throw new Error(
      `No combobox option matching "${value}"${bestPct} (saw: ${options
        .slice(0, 6)
        .map(optionText)
        .join(' | ')})`,
    );
  }

  match.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  pointerClick(match);
  await waitMs(80);
  dismissOpenOverlays(doc, html);

  return (
    readControlValue(html) ||
    (html instanceof HTMLInputElement && html.value) ||
    html.getAttribute('data-value') ||
    optionText(match)
  );
}
