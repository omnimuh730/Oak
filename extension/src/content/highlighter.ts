const OVERLAY_ID = 'oak-highlight-overlay';
const LABEL_ID = 'oak-highlight-label';
const STYLE_ID = 'oak-highlight-style';

let globalCleanup: (() => void) | null = null;

export function highlightElement(el: Element, text?: string): void {
  clearHighlight();

  // Get the document where this element actually lives (might be inside an Iframe)
  const doc = el.ownerDocument;
  const win = doc.defaultView || window;

  const overlay = doc.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('data-oak-inject', 'true');

  const label = doc.createElement('div');
  label.id = LABEL_ID;
  label.setAttribute('data-oak-inject', 'true');

  // Inject styles into the iframe if they aren't there yet
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-oak-inject', 'true');
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        pointer-events: none;
        z-index: 2147483644;
        border: 3px solid #7c6cf0;
        border-radius: 4px;
        box-shadow: 0 0 0 4px rgba(124, 108, 240, 0.35), 0 4px 24px rgba(124, 108, 240, 0.25);
        transition: top 0.15s, left 0.15s, width 0.15s, height 0.15s;
      }
      #${LABEL_ID} {
        position: fixed;
        pointer-events: none;
        z-index: 2147483645;
        background: #7c6cf0;
        color: #fff;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 3px 8px;
        border-radius: 4px;
        white-space: nowrap;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
    `;
    doc.documentElement.appendChild(style);
  }

  doc.documentElement.appendChild(overlay);
  doc.documentElement.appendChild(label);

  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : '';
  const textPart = text ? ` "${text}"` : '';
  label.textContent = `${tag}${id}${cls}${textPart}`;

  const reposition = () => {
    // Because we inject into the Iframe's document, these coordinates map perfectly
    const rect = el.getBoundingClientRect();
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    label.style.top = `${Math.max(4, rect.top - 24)}px`;
    label.style.left = `${rect.left}px`;
  };

  reposition();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => reposition(), 350);

  // Listen to the window that owns this document (the iframe's inner window)
  win.addEventListener('scroll', reposition, true);
  win.addEventListener('resize', reposition);

  globalCleanup = () => {
    win.removeEventListener('scroll', reposition, true);
    win.removeEventListener('resize', reposition);
    doc.querySelectorAll('[data-oak-inject="true"]').forEach((n) => n.remove());
  };
}

export function clearHighlight(): void {
  if (globalCleanup) {
    globalCleanup();
    globalCleanup = null;
  }
  
  // Failsafe: Clear from top document as well just in case
  document.querySelectorAll('[data-oak-inject="true"]').forEach((n) => n.remove());
}