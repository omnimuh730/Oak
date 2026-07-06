import type { DomNode } from '../types';

export const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME']);
const MEDIA_TAGS = new Set(['SVG', 'IMG', 'IMAGE', 'PICTURE', 'CANVAS', 'VIDEO', 'AUDIO']);
const HEAD_NOISE_TAGS = new Set(['LINK', 'META', 'BASE', 'TITLE']);
const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL',
  'SUMMARY', 'OPTION', 'OPTGROUP', 'FIELDSET', 'FORM',
]);
const SEMANTIC_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'BUTTON', 'INPUT',
  'SELECT', 'TEXTAREA', 'LABEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'UL', 'OL', 'LI', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'FORM',
]);
const STRUCTURAL_TAGS = new Set([
  'DIV', 'SPAN', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
]);
const MAX_DEPTH = 32;
const MAX_CHILDREN = 120;
const MAX_TEXT = 120;

function tn(el: Element): string {
  return el.tagName.toUpperCase();
}

export function serializeDom(root: Element = document.documentElement): DomNode {
  const tree = serializeNode(root, 0, []);
  if (!tree) throw new Error('Root element was skipped');
  return tree;
}

/** Wrapper divs/spans without direct text don't consume depth budget. */
function countsTowardDepth(el: Element): boolean {
  const tag = tn(el);
  if (SEMANTIC_TAGS.has(tag) || INTERACTIVE_TAGS.has(tag)) return true;
  if (STRUCTURAL_TAGS.has(tag)) {
    if (hasMeaningfulText(el) || isInteractive(el)) return true;
    if (el.id) return true;
    return false;
  }
  return true;
}

function childDepth(parentDepth: number, child: Element): number {
  return countsTowardDepth(child) ? parentDepth + 1 : parentDepth;
}

function hasTextDescendant(el: Element, limit = 8): boolean {
  if (limit <= 0) return false;
  if (hasMeaningfulText(el)) return true;
  for (const child of el.children) {
    if (SKIP_TAGS.has(tn(child)) || MEDIA_TAGS.has(tn(child))) continue;
    if (hasTextDescendant(child, limit - 1)) return true;
  }
  return false;
}

function hasInteractiveDescendant(el: Element, limit = 8): boolean {
  if (limit <= 0) return false;
  if (isInteractive(el)) return true;
  for (const child of el.children) {
    if (SKIP_TAGS.has(tn(child)) || MEDIA_TAGS.has(tn(child))) continue;
    if (hasInteractiveDescendant(child, limit - 1)) return true;
  }
  return false;
}

/** Skip wrappers whose subtree is only SVG / images with no text or interactive elements. */
export function isSkippableMediaBranch(el: Element): boolean {
  const tag = tn(el);
  if (MEDIA_TAGS.has(tag)) return true;
  if (hasMeaningfulText(el)) return false;
  if (isInteractive(el)) return false;
  if (hasTextDescendant(el)) return false;
  if (hasInteractiveDescendant(el)) return false;

  const childEls = getRelevantChildren(el);
  if (childEls.length === 0) return false;
  return childEls.every(isSkippableMediaBranch);
}

export function getIncludedChildren(el: Element): Element[] {
  const included: Element[] = [];
  for (const child of getRelevantChildren(el).slice(0, MAX_CHILDREN)) {
    if (!shouldOmitElement(child, 1)) included.push(child);
  }
  return included;
}

function getRelevantChildren(el: Element): Element[] {
  return Array.from(el.children).filter((c) => !shouldOmitElement(c, 1));
}

function isInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(tn(el))) return true;
  if (el.getAttribute('role') === 'button') return true;
  if (el.hasAttribute('onclick')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex !== null && tabIndex !== '-1') return true;
  return false;
}

function isHeadNoise(el: Element): boolean {
  if (!HEAD_NOISE_TAGS.has(tn(el))) return false;
  let parent = el.parentElement;
  while (parent) {
    if (tn(parent) === 'HEAD') return true;
    if (tn(parent) === 'BODY' || tn(parent) === 'HTML') return false;
    parent = parent.parentElement;
  }
  return false;
}

function isInsideSvg(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (tn(cur) === 'SVG') return true;
    cur = cur.parentElement;
  }
  return false;
}

function shouldOmitElement(el: Element, depth: number): boolean {
  if (SKIP_TAGS.has(tn(el))) return true;
  if (MEDIA_TAGS.has(tn(el))) return true;
  if (isHeadNoise(el)) return true;
  if (isInsideSvg(el)) return true;
  if (depth > 0 && isSkippableMediaBranch(el)) return true;
  return false;
}

function hasMeaningfulText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length ?? 0) > 0,
  );
}

function getDirectText(el: Element): string | undefined {
  const parts: string[] = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      if (t) parts.push(t);
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join(' ').slice(0, MAX_TEXT);
}

/** Collect direct text from element or immediate text-bearing children (e.g. span, h2). */
function getDisplayText(el: Element): string | undefined {
  const direct = getDirectText(el);
  if (direct) return direct;

  const tag = tn(el);
  if (!STRUCTURAL_TAGS.has(tag) && !SEMANTIC_TAGS.has(tag)) return undefined;

  const parts: string[] = [];
  for (const child of el.children) {
    if (MEDIA_TAGS.has(tn(child))) continue;
    const t = getDirectText(child);
    if (t) parts.push(t);
    if (parts.join(' ').length >= MAX_TEXT) break;
  }
  if (parts.length === 0) return undefined;
  return parts.join(' ').slice(0, MAX_TEXT);
}

function serializeNode(el: Element, depth: number, path: number[]): DomNode | null {
  if (shouldOmitElement(el, depth)) return null;

  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const classList = el.classList?.length ? Array.from(el.classList).slice(0, 5) : undefined;

  const attrs: Record<string, string> = {};
  for (const attr of ['href', 'src', 'type', 'role', 'name', 'data-testid', 'aria-label']) {
    const val = el.getAttribute(attr);
    if (val) attrs[attr] = val.slice(0, 120);
  }

  const text = depth > 0 ? getDisplayText(el) : undefined;

  const children: DomNode[] = [];
  const rawChildEls = Array.from(el.children).filter((c) => !shouldOmitElement(c, depth + 1));

  if (depth < MAX_DEPTH) {
    let serialIndex = 0;
    for (const child of rawChildEls.slice(0, MAX_CHILDREN)) {
      const node = serializeNode(child, childDepth(depth, child), [...path, serialIndex]);
      if (node) {
        children.push(node);
        serialIndex++;
      }
    }
  }

  if (depth > 0 && children.length === 0) {
    if (rawChildEls.length > 0 && rawChildEls.every(isSkippableMediaBranch)) return null;
  }

  return {
    tag,
    id,
    classes: classList,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    text,
    path,
    childCount: el.children.length,
    children,
  };
}
