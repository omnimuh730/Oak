import type { RunStepRecord, RuntimeAttachedFile } from '../../../shared/plan-runner/types';
import type { PipelineProgress } from '../../../shared/pipeline-types';

export function buildResumeUploadProgress(args: {
  recommendedResume: RuntimeAttachedFile | null;
  resumeStack: string | null;
  steps?: RunStepRecord[];
}): NonNullable<PipelineProgress['resumeUpload']> {
  const stack =
    String(args.recommendedResume?.label || args.resumeStack || '').trim() || null;
  const fileName = args.recommendedResume?.name || null;
  const step = args.steps?.find((s) => s.action === 'resume_upload');

  if (step?.status === 'ok') {
    return { status: 'uploaded', stack, fileName };
  }
  if (step?.status === 'skipped' || (args.steps?.length && !step)) {
    return { status: 'skipped', stack, fileName: args.recommendedResume ? fileName : null };
  }
  if (args.recommendedResume) {
    return { status: 'ready', stack, fileName };
  }
  return { status: 'skipped', stack, fileName: null };
}
