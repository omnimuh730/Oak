/** One-click fill pipeline progress contract (extension ↔ sidebar overlay). */

import type { AiUsageSummary } from './ai-usage';
import type { ActionPlan, RunStepRecord } from './plan-runner/types';
import type { DomTreeNode } from './tree-export';

export type PipelinePhase =
  | 'idle'
  | 'fetching'
  | 'analyzing'
  | 'running'
  | 'done'
  | 'error';

export interface PipelineTreeSnapshot {
  url: string;
  title: string;
  tree: DomTreeNode;
  fetchedAt: string;
}

export interface PipelineProgress {
  phase: PipelinePhase;
  message: string;
  stepIndex?: number;
  stepTotal?: number;
  stepLabel?: string;
  error?: string;
  /** Wall-clock ms for the full FAB pipeline (set on done/error). */
  durationMs?: number;
  /** Aggregated AI token usage / estimated USD (analyze + match-option). */
  usage?: AiUsageSummary | null;
  /** UI-only snapshot of the tree sent to AI Analyze. */
  tree?: PipelineTreeSnapshot;
  /** UI-only AI Analyze plan JSON. */
  plan?: ActionPlan;
  /** UI-only live plan-run records (ok / skipped / blocked / failed). */
  steps?: RunStepRecord[];
  /** Library resume used (or skipped) for this tab's Fill run. */
  resumeUpload?: {
    status: 'ready' | 'uploaded' | 'skipped';
    stack: string | null;
    fileName: string | null;
  };
}
