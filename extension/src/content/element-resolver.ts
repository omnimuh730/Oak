export function resolveElementByNodeId(
  nodeId: number, 
  root: Document | Element | ShadowRoot = document
): Element | null {
  // 1. Fast path: Direct query on the current context
  if ('querySelector' in root) {
    const el = root.querySelector(`[data-oak-id="${nodeId}"]`);
    if (el) return el;
  }

  // 2. Slow path: Recursively search through Iframes and Shadow DOMs
  const allElements = root.querySelectorAll('*');
  
  for (const child of Array.from(allElements)) {
    // Pierce Shadow DOM
    if (child.shadowRoot) {
      const found = resolveElementByNodeId(nodeId, child.shadowRoot);
      if (found) return found;
    }
    
    // Pierce Iframe
    if (child.tagName === 'IFRAME') {
      try {
        const doc = (child as HTMLIFrameElement).contentDocument;
        if (doc) {
          const found = resolveElementByNodeId(nodeId, doc);
          if (found) return found;
        }
      } catch (e) {
        // Ignored: CORS blocked cross-origin iframe
      }
    }
  }

  return null;
}