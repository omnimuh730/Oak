import { getIncludedChildren } from './dom-serializer';

export function resolveElementByPath(path: number[]): Element | null {
  let el: Element = document.documentElement;

  for (const index of path) {
    const children = getIncludedChildren(el);
    if (index < 0 || index >= children.length) return null;
    el = children[index];
  }

  return el;
}
