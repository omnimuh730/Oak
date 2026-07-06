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

export interface DomTreeMessage extends DomTreePayload {
  meta?: {
    from: string;
    clientType: string;
    clientName: string;
    url: string;
    title: string;
    tabId: number | null;
    timestamp: number;
    nodeCount: number;
  };
}

export interface ClientInfo {
  id: string;
  type: string;
  name: string;
  connectedAt: number;
}

export interface HighlightPayload {
  path: number[];
  tabId: number;
  url: string;
  extensionId?: string;
}
