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
export const DEFAULT_AI_SERVER = 'http://localhost:3848';

export const MSG = {
  TOGGLE_SIDEBAR: 'oak:toggle-sidebar',
  FETCH_DOM: 'oak:fetch-dom',
  FETCH_AND_EMIT_DOM: 'oak:fetch-and-emit-dom',
  HIGHLIGHT: 'oak:highlight',
  CLEAR_HIGHLIGHT: 'oak:clear-highlight',
  GET_CONTENT: 'oak:get-content',
  EXECUTE_ACTIONS: 'oak:execute-actions',
  PLAN_STEP: 'oak:plan-step',
  MATCH_OPTION: 'oak:match-option',
  START_PIPELINE: 'oak:start-pipeline',
  PIPELINE_PROGRESS: 'oak:pipeline-progress',
  SIDEBAR_OPEN: 'oak:sidebar-open',
  SIDEBAR_CLOSE: 'oak:sidebar-close',
  SOCKET_STATUS: 'oak:socket-status',
} as const;

export interface MatchOptionRequest {
  intendedValue: string;
  options: string[];
  fieldLabel?: string | null;
  typedQuery?: string | null;
}

export interface MatchOptionResponse {
  ok?: boolean;
  matched_option?: string | null;
  confidence?: number;
  reason?: string;
  error?: string;
  model?: string;
  usage?: import('../../shared/ai-usage').AiUsageSummary;
}

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
