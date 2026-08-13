import { sameApplySite } from '../../../shared/apply-site';
import type { RuntimeAttachedFile } from '../../../shared/plan-runner/types';
import type { OakTabJobBinding } from '../tab-job-session';
import { fetchRecommendedResume } from './ai-client';

const WRONG_SITE =
  "Page is not this job's apply site — skipped resume upload";

export async function loadFillResume(input: {
  tabJob: OakTabJobBinding | null;
  apiUrl: string;
}): Promise<{ file: RuntimeAttachedFile | null; skipReason: string | null }> {
  const tabJob = input.tabJob;
  if (!tabJob?.jobId) {
    return { file: null, skipReason: null };
  }

  try {
    const file = await fetchRecommendedResume(tabJob.jobId, input.apiUrl);
    if (!file) {
      return {
        file: null,
        skipReason: tabJob.resumeStack
          ? `Could not load the ${tabJob.resumeStack} file`
          : 'No recommended Library resume for this job',
      };
    }
    return { file, skipReason: null };
  } catch (err) {
    return {
      file: null,
      skipReason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function keepResumeIfSameSite(
  file: RuntimeAttachedFile | null,
  tabJob: OakTabJobBinding | null,
  pageUrl: string,
  skipReason: string | null,
): { file: RuntimeAttachedFile | null; skipReason: string | null } {
  if (!file) return { file: null, skipReason };
  if (!tabJob?.applyUrl || sameApplySite(pageUrl, tabJob.applyUrl)) {
    return { file, skipReason: null };
  }
  return { file: null, skipReason: WRONG_SITE };
}
