export interface DomNode {
  nodeId: number;
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
  tabId?: number;
  frameId?: number;
}

export const DEFAULT_SERVER = 'http://localhost:3847';

export const MSG = {
  TOGGLE_SIDEBAR: 'oak:toggle-sidebar',
  FETCH_DOM: 'oak:fetch-dom',
  FETCH_AND_EMIT_DOM: 'oak:fetch-and-emit-dom',
  HIGHLIGHT: 'oak:highlight',
  CLEAR_HIGHLIGHT: 'oak:clear-highlight',
  GET_CONTENT: 'oak:get-content',
  EXECUTE_ACTIONS: 'oak:execute-actions',
  PLAN_STEP: 'oak:plan-step',
  DEBUG_LOG: 'oak:debug-log',
  SIDEBAR_OPEN: 'oak:sidebar-open',
  SIDEBAR_CLOSE: 'oak:sidebar-close',
  SOCKET_STATUS: 'oak:socket-status',
} as const;

export type PlanStepActionType =
  | 'fill'
  | 'upload'
  | 'select_radio'
  | 'wait'
  | 'validate'
  | 'verify_only';

export interface RuntimeAttachedFile {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
}

export interface PlanStepPayload {
  action: PlanStepActionType;
  element_index: number | null;
  element_indexes: number[] | null;
  expected_label: string | null;
  expected_role: string | null;
  value: string | null;
  file?: RuntimeAttachedFile | null;
  ms: number | null;
}

export interface PlanStepSocketPayload {
  tabId: number;
  url: string;
  extensionId?: string;
  frameId?: number | null;
  step: PlanStepPayload;
}

export interface PlanStepResult {
  ok: boolean;
  verified?: boolean;
  acted?: boolean;
  error?: string;
  details?: {
    nodeId?: number;
    matchedLabel?: string;
    matchedRole?: string;
    valueAfter?: string;
  };
}

export interface HighlightPayload {
  nodeId: number;
  tabId: number;
  url: string;
}

export interface GetContentPayload {
  nodeId: number;
  tabId: number;
  contentType: 'innerHTML' | 'innerText';
}

export interface ActionStep {
  type: 'focus' | 'click' | 'type' | 'wait' | 'keydown' | 'keyup';
  text?: string;
  ms?: number;
  key?: string;
}

export interface ExecuteActionsPayload {
  nodeId: number;
  tabId: number;
  steps: ActionStep[];
}
