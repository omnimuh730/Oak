/** FAB one-click pipeline progress contract (extension ↔ page overlay). */

import type { AiUsageSummary } from './ai-usage';

export type PipelinePhase =
  | 'idle'
  | 'fetching'
  | 'analyzing'
  | 'running'
  | 'done'
  | 'error';

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
}
