const OVERLAY_ID = 'oak-highlight-overlay';
const LABEL_ID = 'oak-highlight-label';

let reposition: (() => void) | null = null;

export function highlightElement(el: Element, text?: string): void {
  clearHighlight();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('data-oak-inject', 'true');

  const label = document.createElement('div');
  label.id = LABEL_ID;
  label.setAttribute('data-oak-inject', 'true');

  const style = document.createElement('style');
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

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);

  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : '';
  const textPart = text ? ` "${text}"` : '';
  label.textContent = `${tag}${id}${cls}${textPart}`;

  reposition = () => {
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
  setTimeout(() => reposition?.(), 350);

  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}

export function clearHighlight(): void {
  if (reposition) {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    reposition = null;
  }

  document.querySelectorAll('[data-oak-inject="true"]').forEach((n) => n.remove());
}
