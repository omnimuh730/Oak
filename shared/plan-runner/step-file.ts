import type { PlanAction, RuntimeAttachedFile } from './types';

export type PlanStepFiles = {
  runtimeFile: RuntimeAttachedFile | null;
  recommendedResume: RuntimeAttachedFile | null;
};

const RECOMMENDED_FILE_KEYS = new Set(['recommended_resume']);

export function isExecutableStep(action: PlanAction['action']): boolean {
  return (
    action === 'fill' ||
    action === 'upload' ||
    action === 'resume_upload' ||
    action === 'select_radio' ||
    action === 'wait' ||
    action === 'validate'
  );
}

export function wantsRecommendedResume(action: PlanAction): boolean {
  if (action.action === 'resume_upload') return true;
  if (action.action !== 'upload') return false;
  return RECOMMENDED_FILE_KEYS.has(String(action.file || '').trim().toLowerCase());
}

export function resolveStepFile(
  action: PlanAction,
  files: PlanStepFiles,
): RuntimeAttachedFile | null {
  if (wantsRecommendedResume(action)) return files.recommendedResume;
  if (action.action === 'upload') return files.runtimeFile;
  return null;
}

export function resumeFileLabel(file: RuntimeAttachedFile | null): string {
  if (!file) return '';
  const stack = String(file.label || '').trim();
  if (stack && stack !== file.name) return `${stack} (${file.name})`;
  return file.name;
}

export function missingUploadReason(
  action: PlanAction,
  files: PlanStepFiles,
): string | null {
  if (action.action !== 'upload' && action.action !== 'resume_upload') {
    return null;
  }
  if (resolveStepFile(action, files)) return null;
  if (wantsRecommendedResume(action)) {
    return 'Resume upload requires the Library resume recommended for this job';
  }
  return 'Upload requires FILE_PATH runtime file, but none was loaded';
}
