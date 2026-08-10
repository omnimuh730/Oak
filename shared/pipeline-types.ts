/** FAB one-click pipeline progress contract (extension ↔ page overlay). */

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
}
