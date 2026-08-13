import type { PipelineProgress } from '../../../shared/pipeline-types';

type ResumeUploadNoteProps = {
  progress: PipelineProgress;
  boundStack: string | null;
  hasBoundJob: boolean;
};

export function ResumeUploadNote({
  progress,
  boundStack,
  hasBoundJob,
}: ResumeUploadNoteProps) {
  const ru = progress.resumeUpload;
  let text: string;
  let tone: 'idle' | 'ready' | 'uploaded' | 'skipped' = 'idle';

  if (ru?.status === 'uploaded') {
    const label = [ru.stack, ru.fileName].filter(Boolean).join(' · ');
    text = `Uploaded ${label || 'recommended resume'}`;
    tone = 'uploaded';
  } else if (ru?.status === 'ready') {
    const label = [ru.stack, ru.fileName].filter(Boolean).join(' · ');
    text = `Will upload ${label || 'recommended resume'}`;
    tone = 'ready';
  } else if (ru?.status === 'skipped') {
    if (ru.stack && !ru.fileName) {
      text = `Could not load the ${ru.stack} file — skipped upload, filling other fields`;
    } else if (ru.stack) {
      text = `Skipped resume upload (${ru.stack}) — filling other fields`;
    } else {
      text = 'No recommended resume — skipped upload, filling other fields';
    }
    tone = 'skipped';
  } else if (hasBoundJob && boundStack) {
    text = `This tab will upload: ${boundStack}`;
  } else if (hasBoundJob) {
    text = 'This tab has no recommended resume — Fill will skip resume upload';
    tone = 'skipped';
  } else {
    text = 'Pick a Worker pool job so Fill can upload its recommended resume';
  }

  return <p className={`resume-upload-note ${tone}`}>{text}</p>;
}
