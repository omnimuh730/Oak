import type { ActionPlan, RuntimeAttachedFile } from './plan-runner/types';

const DEFAULT_AI_SERVER = import.meta.env.VITE_AI_SERVER_URL || 'http://localhost:3848';

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
  usage?: {
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    costUsd: number | null;
    priced?: boolean;
    pricingNote?: string;
  };
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
    throw new Error(typeof data.error === 'string' ? data.error : `Runtime file failed: ${res.status}`);
  }
  return data.file ?? null;
}
