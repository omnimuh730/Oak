import { oakDebugLog } from '../debug-log';
import { resolveDropdownInteractionTarget } from './enhanced-select';
import { askAiMatchOption } from './match-option-client';
import { fillNativeSelect } from './native-select';
import { readControlValue } from './read-control-value';
import {
  OPTION_SIMILARITY_THRESHOLD,
  bestSimilarityMatch,
  isProperTokenExtension,
  isTokenPrefixMatch,
  stringSimilarity,
  stripChoiceMarker,
} from './string-similarity';
import { waitMs } from './wait';

/** Delay between keystrokes when appending a typed word. */
const SMOOTH_TYPE_DELAY_MS = 45;
/** Settle time after each typed word so filtered options can render. */
const WORD_SEARCH_SETTLE_MS = 320;
const OPTION_WAIT_MS = 3000;
/** Typeahead lists are large; closed menus already show every choice. */
const CLOSED_LIST_MAX = 48;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[–—]/g, '-').trim().toLowerCase();
}

function errorKind(error?: string): string | undefined {
  if (!error) return undefined;
  const e = error.toLowerCase();
  if (/sign in|unauthorized|401/.test(e)) return 'auth';
  if (/failed to fetch|networkerror|network/.test(e)) return 'network';
  if (/port closed|receiving end|no response/.test(e)) return 'port';
  if (/400|bad request/.test(e)) return 'bad-request';
  const status = e.match(/failed:\s*(\d{3})/);
  if (status) return `http-${status[1]}`;
  return 'other';
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

function optionSignature(options: HTMLElement[]): string {
  return options.map((opt) => normalize(optionText(opt))).join('\n');
}

async function waitForStableOptions(
  control: HTMLElement,
  doc: Document,
  maxMs = OPTION_WAIT_MS,
): Promise<HTMLElement[]> {
  const started = Date.now();
  let lastSig = '';
  let stableAt = Date.now();
  let last: HTMLElement[] = [];
  while (Date.now() - started < maxMs) {
    const options = pickScopedOptions(control, doc);
    const sig = optionSignature(options);
    if (sig !== lastSig) {
      lastSig = sig;
      stableAt = Date.now();
      last = options;
    } else if (options.length && Date.now() - stableAt >= 200) {
      return options;
    }
    await waitMs(50);
  }
  return last.length ? last : pickScopedOptions(control, doc);
}

function displayedListboxes(control: HTMLElement, doc: Document): HTMLElement[] {
  const owned = listboxRootsForControl(control, doc).filter(
    (node) => isDisplayed(node) || collectOptionsInRoot(node).length > 0,
  );
  if (owned.length) return owned;
  return Array.from(doc.querySelectorAll('[role="listbox"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node),
  );
}

async function collectOptionsByScrolling(
  control: HTMLElement,
  doc: Document,
): Promise<HTMLElement[]> {
  const byKey = new Map<string, HTMLElement>();
  const add = (opts: HTMLElement[]) => {
    for (const opt of opts) {
      const key = normalize(optionText(opt));
      if (key && !byKey.has(key)) byKey.set(key, opt);
    }
  };

  add(pickScopedOptions(control, doc));
  const boxes = displayedListboxes(control, doc);
  const scrollTargets = new Set<HTMLElement>();
  for (const box of boxes) {
    if (box.scrollHeight > box.clientHeight + 8) scrollTargets.add(box);
    for (const child of Array.from(box.children)) {
      if (child instanceof HTMLElement && child.scrollHeight > child.clientHeight + 8) {
        scrollTargets.add(child);
      }
    }
  }

  const targets = scrollTargets.size ? [...scrollTargets] : boxes;
  for (const box of targets) {
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    if (maxScroll <= 0) {
      add(collectOptionsInRoot(box));
      continue;
    }
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      box.scrollTop = (maxScroll * i) / steps;
      await waitMs(40);
      add(collectOptionsInRoot(box));
      add(pickScopedOptions(control, doc));
    }
    box.scrollTop = 0;
  }
  return Array.from(byKey.values());
}

async function findLiveOption(
  control: HTMLElement,
  doc: Document,
  label: string,
): Promise<HTMLElement | null> {
  const want = normalize(label);
  const visible = pickScopedOptions(control, doc).find(
    (opt) => normalize(optionText(opt)) === want,
  );
  if (visible?.isConnected) return visible;

  const scrolled = await collectOptionsByScrolling(control, doc);
  const live = scrolled.find(
    (opt) => opt.isConnected && normalize(optionText(opt)) === want,
  );
  if (live) return live;

  const boxes = displayedListboxes(control, doc);
  for (const box of boxes) {
    const maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      box.scrollTop = maxScroll ? (maxScroll * i) / steps : 0;
      await waitMs(40);
      const hit = collectOptionsInRoot(box).find(
        (opt) => opt.isConnected && normalize(optionText(opt)) === want,
      );
      if (hit) return hit;
    }
  }
  return null;
}

async function openAndCollectOptions(
  html: HTMLElement,
  doc: Document,
): Promise<HTMLElement[]> {
  await focusAndOpenCombobox(html);
  let options = await waitForStableOptions(html, doc);
  if (!options.length) {
    html.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    options = await waitForStableOptions(html, doc);
  }
  const scrolled = await collectOptionsByScrolling(html, doc);
  return scrolled.length >= options.length ? scrolled : options;
}

function findLocalMatch(
  options: HTMLElement[],
  value: string,
): { match: HTMLElement | null; score: number | null; strategy: string } {
  const target = normalize(value);
  const targetBare = normalize(stripChoiceMarker(value));
  if (!target) return { match: null, score: null, strategy: 'empty' };

  const exact = options.find((opt) => {
    const have = normalize(optionText(opt));
    const haveBare = normalize(stripChoiceMarker(optionText(opt)));
    return have === target || haveBare === targetBare;
  });
  if (exact) return { match: exact, score: 1, strategy: 'exact' };

  if (target.length <= 3) {
    const tokenExact = options.find((opt) => {
      const tokens = normalize(stripChoiceMarker(optionText(opt)))
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      if (tokens.length > 4) return false;
      return tokens.includes(target) || tokens.includes(targetBare);
    });
    if (tokenExact) return { match: tokenExact, score: 1, strategy: 'tokenExact' };
  }

  if (targetBare.length >= 4) {
    // Same answer with longer wording (disability / veteran blurbs), or country "+1".
    // Do NOT require 90% edit similarity — long trailing text tanks Levenshtein.
    const prefix = options.find((opt) => {
      const label = stripChoiceMarker(optionText(opt));
      if (isProperTokenExtension(value, label)) return false;
      if (isTokenPrefixMatch(targetBare, label) || isTokenPrefixMatch(value, optionText(opt))) {
        return true;
      }
      const text = normalize(label);
      if (text.startsWith(targetBare)) return true;
      if (text.includes(`${targetBare}+`) || text.startsWith(`${targetBare} +`)) return true;
      return false;
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

  const aiConfidence =
    typeof ai.confidence === 'number' ? ai.confidence : 0;
  const el = ai.matched_option
    ? resolveOptionElement(options, ai.matched_option)
    : null;
  // #region agent log
  oakDebugLog('G', 'select-combobox.ts:ai', 'combobox AI match', {
    ok: Boolean(ai.ok),
    hasPick: Boolean(el),
    confidence: Math.round(aiConfidence * 100),
    optionCount: options.length,
    intendedLen: value.trim().length,
    errorKind: errorKind(ai.error),
  });
  // #endregion
  if (el && !isProperTokenExtension(value, optionText(el))) {
    return {
      match: el,
      score: aiConfidence || 1,
      strategy: 'ai',
    };
  }

  return { match: null, score: local.score, strategy: local.strategy };
}

/**
 * 1) Focus → collect initial candidates → local match → AI match
 * 2) If still unmatched: type one word at a time, wait for filtered list, AI-match again
 */
export async function selectComboboxOption(el: Element, value: string): Promise<string> {
  const requested = el as HTMLElement;
  if (requested instanceof HTMLSelectElement) {
    return fillNativeSelect(requested, value);
  }
  const html = resolveDropdownInteractionTarget(requested);
  if (html instanceof HTMLSelectElement) {
    return fillNativeSelect(html, value);
  }
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
  let options = await openAndCollectOptions(html, doc);

  // #region agent log
  oakDebugLog('D', 'select-combobox.ts:options', 'combobox options after open', {
    optionCount: options.length,
    intendedLen: value.trim().length,
    intendedIsShort: value.trim().length <= 3,
    controlTag: html.tagName,
    controlRole: (html.getAttribute('role') || '').toLowerCase(),
  });
  // #endregion

  let { match, score } = await matchFromCandidates(options, value, fieldLabel, null);
  const initialOptions = options;
  const closedList =
    initialOptions.length > 0 && initialOptions.length <= CLOSED_LIST_MAX;

  if (!match && closedList && initialOptions.length === 1) {
    match = initialOptions[0];
    score = 1;
    // #region agent log
    oakDebugLog('G', 'select-combobox.ts:sole', 'closed list sole option', {
      optionCount: 1,
      intendedLen: value.trim().length,
    });
    // #endregion
  }

  // Word-by-word typing only for typeahead (empty or very large lists).
  // Closed menus already show every candidate — typing filters them away.
  const typeable = resolveTypeableInput(html);
  // #region agent log
  oakDebugLog('H', 'select-combobox.ts:path', 'combobox match path', {
    optionCount: initialOptions.length,
    closedList,
    hasMatch: Boolean(match),
    solePick: Boolean(match) && initialOptions.length === 1,
    willType:
      !match &&
      !closedList &&
      Boolean(typeable) &&
      value.trim().length >= 2,
  });
  // #endregion
  if (!match && !closedList && typeable && value.trim().length >= 2) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    let typed = '';

    for (const word of words) {
      typed = typed ? `${typed} ${word}` : word;
      await focusAndOpenCombobox(html);
      await typeQueryIntoOpenCombobox(html, typed);
      const filtered = await waitForScopedOptions(html, doc, 2000);
      if (!filtered.length) {
        options = initialOptions.length
          ? initialOptions
          : await openAndCollectOptions(html, doc);
        break;
      }
      options = filtered;
      const resolved = await matchFromCandidates(options, value, fieldLabel, typed);
      match = resolved.match;
      score = resolved.score;
      if (match) break;
    }
  }

  if (!match) {
    dismissOpenOverlays(doc, html);
    await waitMs(450);
    options = await openAndCollectOptions(html, doc);
    // #region agent log
    oakDebugLog('D', 'select-combobox.ts:retry', 'combobox options after cascade retry', {
      optionCount: options.length,
      intendedLen: value.trim().length,
    });
    // #endregion
    const resolved = await matchFromCandidates(options, value, fieldLabel, null);
    match = resolved.match;
    score = resolved.score;
  }

  if (!match) {
    const bestPct =
      score != null
        ? ` (best ${(score * 100).toFixed(1)}% < ${OPTION_SIMILARITY_THRESHOLD * 100}%)`
        : '';
    const sawFrom = options.length ? options : initialOptions;
    throw new Error(
      `No combobox option matching "${value}"${bestPct} (saw: ${sawFrom
        .slice(0, 6)
        .map(optionText)
        .join(' | ')})`,
    );
  }

  const label = optionText(match);
  const live = match.isConnected ? match : await findLiveOption(html, doc, label);
  const clickTarget = live || match;
  clickTarget.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  pointerClick(clickTarget);
  await waitMs(80);
  dismissOpenOverlays(doc, html);

  const displayed = readControlValue(html);
  // #region agent log
  oakDebugLog('D', 'select-combobox.ts:afterClick', 'combobox value after option click', {
    intendedLen: value.trim().length,
    displayedLen: String(displayed || '').length,
    looksPlaceholder: !displayed,
    controlTag: html.tagName,
    controlRole: (html.getAttribute('role') || '').toLowerCase(),
    intendedPreview: /^(yes|no)$/i.test(value.trim()) ? value.trim() : undefined,
  });
  // #endregion

  return (
    displayed ||
    (html instanceof HTMLInputElement && html.value) ||
    html.getAttribute('data-value') ||
    optionText(match)
  );
}
