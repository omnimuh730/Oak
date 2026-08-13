import type { RuntimeAttachedFile } from '../../types';
import { uploadFileToElement } from './upload';

/**
 * Attach the Job Search recommended Library resume to a file input.
 * Called when the AI plan emits `resume_upload`.
 */
export async function resumeUpload(
  el: Element,
  file: RuntimeAttachedFile,
): Promise<string> {
  return uploadFileToElement(el, file);
}
