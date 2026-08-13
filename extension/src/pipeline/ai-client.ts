import type { AiUsageSummary } from '../../../shared/ai-usage';
import type { ActionPlan, RuntimeAttachedFile } from '../../../shared/plan-runner/types';
import {
  authHeaders,
  getAthensApiUrl,
} from '../auth/oak-auth';

export interface AiAnalyzePage {
  title?: string;
  url?: string;
  fetchedAt?: string;
  job?: {
    id: string;
    title: string;
    company: string;
  } | null;
  recommendedResumeAvailable?: boolean;
  recommendedResumeStack?: string | null;
}

export interface AiAnalyzeRequest {
  pureTree: string;
  metaTree: string;
  page?: AiAnalyzePage | null;
}

export interface AiAnalyzeResponse {
  ok?: boolean;
  plan?: ActionPlan;
  model?: string;
  responseId?: string | null;
  error?: string;
  usage?: AiUsageSummary;
}

export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  _apiUrl?: string,
): Promise<AiAnalyzeResponse> {
  const base = (_apiUrl || (await getAthensApiUrl())).replace(/\/$/, '');
  const res = await fetch(`${base}/api/oak/ai-analyze`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as AiAnalyzeResponse & {
    message?: string;
    success?: boolean;
  };
  if (!res.ok) {
    throw new Error(extractError(data, `AI analyze failed: ${res.status}`));
  }
  if (!data.plan) {
    throw new Error(extractError(data, 'AI backend returned no plan'));
  }
  return data;
}

function extractError(
  data: { error?: unknown; message?: unknown },
  fallback: string,
): string {
  const nested =
    data.message && typeof data.message === 'object'
      ? (data.message as { error?: unknown; message?: unknown })
      : null;
  for (const candidate of [
    data.error,
    nested?.error,
    data.message,
    nested?.message,
  ]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const text = candidate.trim();
      if (text !== 'Bad Request' && text !== 'Unauthorized') return text;
    }
  }
  return fallback;
}

export async function fetchRuntimeFile(
  _apiUrl?: string,
): Promise<RuntimeAttachedFile | null> {
  const base = (_apiUrl || (await getAthensApiUrl())).replace(/\/$/, '');
  const res = await fetch(`${base}/api/oak/runtime-file`, {
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    file?: RuntimeAttachedFile;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(
      typeof data.error === 'string' ? data.error : `Runtime file failed: ${res.status}`,
    );
  }
  return data.file ?? null;
}

export async function fetchRecommendedResume(
  jobId: string,
  _apiUrl?: string,
): Promise<RuntimeAttachedFile | null> {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const base = (_apiUrl || (await getAthensApiUrl())).replace(/\/$/, '');
  const res = await fetch(
    `${base}/api/oak/jobs/${encodeURIComponent(id)}/recommended-resume`,
    { headers: await authHeaders() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    file?: RuntimeAttachedFile;
    stack?: string | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : `Recommended resume failed: ${res.status}`,
    );
  }
  if (!data.file) return null;
  const stack = String(data.stack || data.file.label || '').trim();
  return {
    ...data.file,
    label: stack || data.file.name,
  };
}
