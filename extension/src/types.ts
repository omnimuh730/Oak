export interface DomNode {
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  path: number[];
  childCount: number;
  children: DomNode[];
}

export interface DomTreePayload {
  url: string;
  title: string;
  tree: DomNode;
  fetchedAt: string;
  tabId?: number;
}

export const DEFAULT_SERVER = 'http://localhost:3847';

export const MSG = {
  TOGGLE_SIDEBAR: 'oak:toggle-sidebar',
  FETCH_DOM: 'oak:fetch-dom',
  FETCH_AND_EMIT_DOM: 'oak:fetch-and-emit-dom',
  HIGHLIGHT: 'oak:highlight',
  CLEAR_HIGHLIGHT: 'oak:clear-highlight',
  SIDEBAR_OPEN: 'oak:sidebar-open',
  SIDEBAR_CLOSE: 'oak:sidebar-close',
  SOCKET_STATUS: 'oak:socket-status',
} as const;

export interface HighlightPayload {
  path: number[];
  tabId: number;
  url: string;
}
