import type { AiUsageSummary } from '../../../shared/ai-usage';
import type { ActionPlan, RuntimeAttachedFile } from '../../../shared/plan-runner/types';
import { DEFAULT_AI_SERVER } from '../types';

export interface AiAnalyzePage {
  title?: string;
  url?: string;
  fetchedAt?: string;
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

function aiBase(aiServerUrl: string = DEFAULT_AI_SERVER): string {
  return aiServerUrl.replace(/\/$/, '');
}

export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  aiServerUrl: string = DEFAULT_AI_SERVER,
): Promise<AiAnalyzeResponse> {
  const res = await fetch(`${aiBase(aiServerUrl)}/api/ai-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as AiAnalyzeResponse;
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `AI analyze failed: ${res.status}`,
    );
  }
  if (!data.plan) {
    throw new Error(data.error || 'AI backend returned no plan');
  }
  return data;
}

export async function fetchRuntimeFile(
  aiServerUrl: string = DEFAULT_AI_SERVER,
): Promise<RuntimeAttachedFile | null> {
  const res = await fetch(`${aiBase(aiServerUrl)}/api/runtime-file`);
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
