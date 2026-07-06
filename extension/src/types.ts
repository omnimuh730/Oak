export interface DomNode {
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  text?: string;
  childCount: number;
  children: DomNode[];
}

export interface DomTreePayload {
  url: string;
  title: string;
  tree: DomNode;
  fetchedAt: string;
}

export const DEFAULT_SERVER = 'http://localhost:3847';

export const MSG = {
  TOGGLE_SIDEBAR: 'oak:toggle-sidebar',
  FETCH_DOM: 'oak:fetch-dom',
  SIDEBAR_OPEN: 'oak:sidebar-open',
  SIDEBAR_CLOSE: 'oak:sidebar-close',
} as const;
