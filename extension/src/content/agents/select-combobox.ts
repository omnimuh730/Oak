import { oakDebugLog } from '../../debug-log';
import { readControlValue } from './read-control-value';
import {
  OPTION_SIMILARITY_THRESHOLD,
  bestSimilarityMatch,
  stringSimilarity,
} from './string-similarity';
import { waitMs } from './wait';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function optionText(el: Element): string {
  return ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
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

function listboxRootsForControl(control: HTMLElement, doc: Document): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const refIds = [
    control.getAttribute('aria-controls'),
    control.getAttribute('aria-owns'),
    control.getAttribute('list'),
  ]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const id of refIds) {
    const node = doc.getElementById(id);
    if (node instanceof HTMLElement) roots.push(node);
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
      if (!text || text.length > 200) continue;
      found.add(html);
    }
  }
  return Array.from(found);
}

function scoreListbox(listbox: HTMLElement, control: HTMLElement): number {
  const controlRect = control.getBoundingClientRect();
  const boxRect = listbox.getBoundingClientRect();
  if (boxRect.width === 0 && boxRect.height === 0) return Number.POSITIVE_INFINITY;
  const dx = Math.abs(boxRect.left - controlRect.left);
  const dy = Math.abs(boxRect.top - controlRect.bottom);
  return dx + dy;
}

function pickScopedOptions(control: HTMLElement, doc: Document): HTMLElement[] {
  const owned = listboxRootsForControl(control, doc);
  for (const root of owned) {
    if (!isDisplayed(root) && collectOptionsInRoot(root).length === 0) continue;
    const options = collectOptionsInRoot(root);
    if (options.length) return options;
  }

  const listboxes = Array.from(doc.querySelectorAll('[role="listbox"]')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isDisplayed(node),
  );

  if (listboxes.length) {
    listboxes.sort((a, b) => scoreListbox(a, control) - scoreListbox(b, control));
    for (const listbox of listboxes) {
      const options = collectOptionsInRoot(listbox);
      if (options.length) return options;
    }
  }

  // Last resort: options that share a nearby field container with the control.
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
  maxMs = 3000,
): Promise<HTMLElement[]> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const options = pickScopedOptions(control, doc);
    if (options.length) return options;
    await waitMs(50);
  }
  return [];
}

/**
 * Prefer exact / token / prefix matches, then highest string similarity ≥ threshold.
 * Uses Levenshtein matrix + bigram Dice (see string-similarity.ts). Rejects weak
 * token overlaps that previously mis-selected e.g. "identify" on Veteran Status.
 */
function findMatchingOption(
  options: HTMLElement[],
  value: string,
): { match: HTMLElement | null; score: number | null; strategy: string } {
  const target = normalize(value);
  if (!target) return { match: null, score: null, strategy: 'empty' };

  const exact = options.find((opt) => normalize(optionText(opt)) === target);
  if (exact) return { match: exact, score: 1, strategy: 'exact' };

  // Whole-value token match only for short values (Yes/No) — avoids "No" ⊂ "Lebanon".
  if (target.length <= 3) {
    const tokenExact = options.find((opt) => {
      const tokens = normalize(optionText(opt)).split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.includes(target);
    });
    if (tokenExact) return { match: tokenExact, score: 1, strategy: 'tokenExact' };
  }

  // Longer targets may match a prefix of option text ("United States" → "United States +1").
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

  const scored = bestSimilarityMatch(
    value,
    options,
    optionText,
    OPTION_SIMILARITY_THRESHOLD,
  );
  if (scored) {
    return { match: scored.item, score: scored.score, strategy: 'similarity' };
  }

  // Log best below-threshold candidate for debugging.
  let bestBelow: { text: string; score: number } | null = null;
  for (const opt of options) {
    const score = stringSimilarity(value, optionText(opt));
    if (!bestBelow || score > bestBelow.score) {
      bestBelow = { text: optionText(opt), score };
    }
  }

  return {
    match: null,
    score: bestBelow?.score ?? null,
    strategy: bestBelow ? `belowThreshold:${bestBelow.text}` : 'none',
  };
}

async function typeFilterValue(el: HTMLElement, value: string): Promise<void> {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
  el.focus();
  const proto = HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
  );
  await waitMs(80);
}

/** Open a combobox/listbox control and choose an option by visible text. */
export async function selectComboboxOption(el: Element, value: string): Promise<string> {
  const html = el as HTMLElement;
  const doc = el.ownerDocument || document;
  const oakId = html.getAttribute('data-oak-id');

  html.scrollIntoView({ block: 'center', behavior: 'auto' });
  dismissOpenOverlays(doc, html);
  await waitMs(40);

  html.focus?.();
  pointerClick(html);

  let options = await waitForScopedOptions(html, doc);
  let openStrategy: string = options.length ? 'click' : 'none';

  if (!options.length) {
    html.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    options = await waitForScopedOptions(html, doc);
    if (options.length) openStrategy = 'arrowDown';
  }

  if (!options.length) {
    await typeFilterValue(html, value);
    options = await waitForScopedOptions(html, doc);
    if (options.length) openStrategy = 'typeFilter';
  }

  const ownedIds = [
    html.getAttribute('aria-controls'),
    html.getAttribute('aria-owns'),
  ].filter(Boolean);

  // #region agent log
  oakDebugLog(
    'select-combobox.ts:options',
    'combobox options after open',
    {
      oakId,
      value,
      openStrategy,
      optionCount: options.length,
      optionPreview: options.slice(0, 8).map(optionText),
      role: html.getAttribute('role'),
      tag: html.tagName,
      ariaExpanded: html.getAttribute('aria-expanded'),
      ariaHaspopup: html.getAttribute('aria-haspopup'),
      ariaControls: ownedIds,
      visibleListboxCount: Array.from(doc.querySelectorAll('[role="listbox"]')).filter(
        (node) => node instanceof HTMLElement && isDisplayed(node),
      ).length,
    },
    'B',
  );
  // #endregion

  if (!options.length) {
    throw new Error('No listbox options appeared after opening combobox');
  }

  const { match, score, strategy } = findMatchingOption(options, value);
  if (!match) {
    const bestPct = score != null ? ` (best ${(score * 100).toFixed(1)}% < ${OPTION_SIMILARITY_THRESHOLD * 100}%)` : '';
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

  const valueAfter =
    readControlValue(html) ||
    (html instanceof HTMLInputElement && html.value) ||
    html.getAttribute('data-value') ||
    optionText(match);

  // #region agent log
  oakDebugLog(
    'select-combobox.ts:selected',
    'combobox option clicked',
    {
      oakId,
      value,
      matched: optionText(match),
      matchStrategy: strategy,
      matchScore: score,
      valueAfter,
      inputValue: html instanceof HTMLInputElement ? html.value : null,
    },
    'C',
  );
  // #endregion

  return valueAfter;
}
