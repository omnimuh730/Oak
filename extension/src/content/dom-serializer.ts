import type { DomNode } from '../types';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME']);
const MEDIA_TAGS = new Set(['SVG', 'IMG', 'IMAGE', 'PICTURE']);
const MAX_DEPTH = 12;
const MAX_CHILDREN = 80;
const MAX_TEXT = 80;

export function serializeDom(root: Element = document.documentElement): DomNode {
  const tree = serializeNode(root, 0);
  if (!tree) throw new Error('Root element was skipped');
  return tree;
}

/** Skip wrappers whose descendants are only SVG / image elements. */
function isSkippableMediaBranch(el: Element): boolean {
  if (MEDIA_TAGS.has(el.tagName)) return true;
  if (hasMeaningfulText(el)) return false;

  const childEls = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName));
  if (childEls.length === 0) return false;
  return childEls.every(isSkippableMediaBranch);
}

function hasMeaningfulText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length ?? 0) > 0,
  );
}

function serializeNode(el: Element, depth: number): DomNode | null {
  if (depth > 0 && isSkippableMediaBranch(el)) return null;

  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const classList = el.classList?.length ? Array.from(el.classList).slice(0, 5) : undefined;

  const attrs: Record<string, string> = {};
  for (const attr of ['href', 'src', 'type', 'role', 'name', 'data-testid']) {
    const val = el.getAttribute(attr);
    if (val) attrs[attr] = val.slice(0, 120);
  }

  let text: string | undefined;
  if (depth > 0 && el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
    const raw = el.textContent?.trim();
    if (raw) text = raw.slice(0, MAX_TEXT);
  }

  const children: DomNode[] = [];
  if (depth < MAX_DEPTH) {
    const childEls = Array.from(el.children).filter((c) => !SKIP_TAGS.has(c.tagName));
    for (const child of childEls.slice(0, MAX_CHILDREN)) {
      const node = serializeNode(child, depth + 1);
      if (node) children.push(node);
    }
  }

  return {
    tag,
    id,
    classes: classList,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    text,
    childCount: el.children.length,
    children,
  };
}
