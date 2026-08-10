import type { AiUsageSummary } from '../../../shared/ai-usage';

let active: AiUsageSummary | null = null;

function emptyUsage(): AiUsageSummary {
  return {
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    priced: true,
    calls: 0,
  };
}

export function beginPipelineUsageTracking(): void {
  active = emptyUsage();
}

export function addPipelineUsage(part: AiUsageSummary | null | undefined): void {
  if (!active || !part) return;

  active.inputTokens += part.inputTokens || 0;
  active.outputTokens += part.outputTokens || 0;
  active.cachedInputTokens += part.cachedInputTokens || 0;
  active.totalTokens += part.totalTokens || 0;
  active.calls = (active.calls || 0) + (part.calls || 1);

  if (typeof part.costUsd === 'number') {
    active.costUsd = (active.costUsd || 0) + part.costUsd;
  } else {
    active.priced = false;
  }

  if (part.model) {
    const models = new Set(
      (active.model ? active.model.split('+') : []).filter(Boolean),
    );
    for (const m of part.model.split('+')) {
      if (m) models.add(m);
    }
    active.model = [...models].join('+') || null;
  }
}

export function endPipelineUsageTracking(): AiUsageSummary | null {
  const summary = active;
  active = null;
  if (!summary) return null;
  if (typeof summary.costUsd === 'number') {
    summary.costUsd = Math.round(summary.costUsd * 1e6) / 1e6;
  }
  return summary;
}

export function isPipelineUsageTracking(): boolean {
  return active != null;
}
