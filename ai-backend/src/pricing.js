/**
 * OpenAI list prices (USD per 1M tokens), Standard short-context tier.
 * Sources:
 * - https://developers.openai.com/api/docs/pricing (gpt-5.6-*)
 * - https://developers.openai.com/api/docs/models/gpt-5.4-mini
 * - https://developers.openai.com/api/docs/models/gpt-5.4-nano
 * - https://developers.openai.com/api/docs/models/gpt-5-nano
 *
 * Long-context rates (input > LONG_CONTEXT_INPUT_TOKENS) apply to gpt-5.6-* only.
 */

/** OpenAI long-context pricing threshold for GPT-5.6 family. */
export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

/** @typedef {{ input: number, cachedInput: number, cacheWrite?: number, output: number }} Rate */

/** @type {Record<string, { short: Rate, long?: Rate }>} */
const MODEL_RATES = {
  'gpt-5.6-sol': {
    short: { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 30.0 },
    long: { input: 10.0, cachedInput: 1.0, cacheWrite: 12.5, output: 45.0 },
  },
  'gpt-5.6-terra': {
    short: { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 12.0 },
    long: { input: 4.0, cachedInput: 0.4, cacheWrite: 5.0, output: 18.0 },
  },
  'gpt-5.6-luna': {
    short: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  'gpt-5.4-mini': {
    short: { input: 0.75, cachedInput: 0.075, output: 4.5 },
  },
  'gpt-5.4-nano': {
    short: { input: 0.2, cachedInput: 0.02, output: 1.25 },
  },
  'gpt-5-nano': {
    short: { input: 0.05, cachedInput: 0.005, output: 0.4 },
  },
};

const ALIASES = {
  sol: 'gpt-5.6-sol',
  terra: 'gpt-5.6-terra',
  luna: 'gpt-5.6-luna',
  '5.6-sol': 'gpt-5.6-sol',
  '5.6-terra': 'gpt-5.6-terra',
  '5.6-luna': 'gpt-5.6-luna',
  'gpt-5.6-sol-fast': 'gpt-5.6-sol',
  'gpt-5.6-terra-fast': 'gpt-5.6-terra',
  'gpt-5.6-luna-fast': 'gpt-5.6-luna',
  '5.4-mini': 'gpt-5.4-mini',
  '5.4-nano': 'gpt-5.4-nano',
  '5-nano': 'gpt-5-nano',
  'gpt5-nano': 'gpt-5-nano',
};

/**
 * @param {string | null | undefined} model
 * @returns {{ canonical: string | null, fastMultiplier: number }}
 */
export function normalizeModelId(model) {
  if (!model || typeof model !== 'string') {
    return { canonical: null, fastMultiplier: 1 };
  }
  const raw = model.trim().toLowerCase();
  const fastMultiplier = /(?:^|-)fast$/.test(raw) || raw.includes('-fast-') ? 2 : 1;
  const stripped = raw.replace(/-fast(?=-|$)/g, '');
  const aliased = ALIASES[stripped] || ALIASES[raw] || stripped;
  if (MODEL_RATES[aliased]) {
    return { canonical: aliased, fastMultiplier };
  }
  // Snapshot ids like gpt-5.4-mini-2026-03-17
  for (const key of Object.keys(MODEL_RATES)) {
    if (aliased === key || aliased.startsWith(`${key}-`)) {
      return { canonical: key, fastMultiplier };
    }
  }
  return { canonical: null, fastMultiplier };
}

/**
 * @param {unknown} usage OpenAI Responses API usage object
 * @param {string} model
 */
export function summarizeUsage(usage, model) {
  const inputTokens = num(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = num(usage?.output_tokens ?? usage?.completion_tokens);
  const cachedInputTokens = num(
    usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens,
  );
  const totalTokens = num(usage?.total_tokens) || inputTokens + outputTokens;
  const cost = estimateCostUsd({
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
  });

  return {
    model: cost.model || model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    costUsd: cost.costUsd,
    priced: cost.priced,
    pricingNote: cost.pricingNote,
  };
}

/**
 * @param {{
 *   model: string,
 *   inputTokens: number,
 *   outputTokens: number,
 *   cachedInputTokens?: number,
 * }} args
 */
export function estimateCostUsd({
  model,
  inputTokens,
  outputTokens,
  cachedInputTokens = 0,
}) {
  const { canonical, fastMultiplier } = normalizeModelId(model);
  if (!canonical) {
    return {
      model,
      costUsd: null,
      priced: false,
      pricingNote: `No list price configured for model "${model}"`,
    };
  }

  const table = MODEL_RATES[canonical];
  const useLong =
    Boolean(table.long) && inputTokens > LONG_CONTEXT_INPUT_TOKENS;
  const rate = useLong ? table.long : table.short;
  const cached = Math.min(Math.max(0, cachedInputTokens), Math.max(0, inputTokens));
  const uncached = Math.max(0, inputTokens - cached);

  const perMillion = (tokens, price) => (tokens / 1_000_000) * price * fastMultiplier;
  const costUsd =
    perMillion(uncached, rate.input) +
    perMillion(cached, rate.cachedInput) +
    perMillion(outputTokens, rate.output);

  return {
    model: canonical,
    costUsd: roundUsd(costUsd),
    priced: true,
    pricingNote: useLong
      ? `Long-context rates (>${LONG_CONTEXT_INPUT_TOKENS} input tokens)`
      : fastMultiplier > 1
        ? 'Fast mode (2× standard rates)'
        : undefined,
  };
}

/**
 * @param {Array<ReturnType<typeof summarizeUsage> | null | undefined>} parts
 */
export function mergeUsageSummaries(parts) {
  const list = (parts ?? []).filter(Boolean);
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let priced = true;
  const models = new Set();

  for (const part of list) {
    inputTokens += part.inputTokens || 0;
    outputTokens += part.outputTokens || 0;
    cachedInputTokens += part.cachedInputTokens || 0;
    totalTokens += part.totalTokens || 0;
    if (typeof part.costUsd === 'number') costUsd += part.costUsd;
    else priced = false;
    if (part.model) models.add(part.model);
  }

  return {
    model: [...models].join('+') || null,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    costUsd: priced ? roundUsd(costUsd) : null,
    priced,
    calls: list.length,
  };
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundUsd(value) {
  return Math.round(value * 1e6) / 1e6;
}
