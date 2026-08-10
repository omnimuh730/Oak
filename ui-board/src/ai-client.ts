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
  plan?: unknown;
  model?: string;
  responseId?: string | null;
  error?: string;
}

export async function requestAiAnalyze(
  payload: AiAnalyzeRequest,
  aiServerUrl: string = DEFAULT_AI_SERVER,
): Promise<AiAnalyzeResponse> {
  const res = await fetch(`${aiServerUrl.replace(/\/$/, '')}/api/ai-analyze`, {
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
