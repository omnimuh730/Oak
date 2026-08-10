export interface TokenConsume {
  model: string;
  pricingModel: string | null;
  pricingFound: boolean;
  inputCached: number;
  inputCacheMiss: number;
  output: number;
  costUsd: number | null;
  rates?: {
    inputPerMillion: number;
    cachedInputPerMillion: number;
    outputPerMillion: number;
  } | null;
}

export function formatTokenCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatConsumeUsd(value: number | null): string {
  if (value == null) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function mergeConsumeTotals(
  current: TokenConsume | null,
  next: TokenConsume | null,
): TokenConsume | null {
  if (!next) return current;
  if (!current) return next;

  const inputCached = current.inputCached + next.inputCached;
  const inputCacheMiss = current.inputCacheMiss + next.inputCacheMiss;
  const output = current.output + next.output;
  const costUsd =
    current.costUsd == null || next.costUsd == null
      ? current.costUsd ?? next.costUsd
      : current.costUsd + next.costUsd;

  return {
    model: next.model || current.model,
    pricingModel: next.pricingModel || current.pricingModel,
    pricingFound: current.pricingFound && next.pricingFound,
    inputCached,
    inputCacheMiss,
    output,
    costUsd,
    rates: next.rates ?? current.rates,
  };
}
