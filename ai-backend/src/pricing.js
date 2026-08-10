import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PRICE_PATH = path.resolve(__dirname, '../../API-Price.md');

let standardPricingCache = null;

function parsePriceCell(value) {
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '-' || trimmed === 'null' || /^free$/i.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function normalizeModelLabel(label) {
  return label
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim()
    .toLowerCase();
}

function parseStandardPricingRows(markdown) {
  const blocks = [...markdown.matchAll(/tier="standard"[\s\S]*?rows=\{\[([\s\S]*?)\]\}/g)];
  if (!blocks.length) {
    throw new Error('Could not find standard pricing rows in API-Price.md');
  }

  const rows = [];
  const rowPattern = /\[\s*"([^"]+)"\s*,\s*([^,\]]+)\s*,\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/g;

  for (const block of blocks) {
    const body = block[1];
    for (const match of body.matchAll(rowPattern)) {
      const [, label, inputRaw, cachedRaw, outputRaw] = match;
      rows.push({
        label,
        modelKey: normalizeModelLabel(label),
        inputPerMillion: parsePriceCell(inputRaw),
        cachedInputPerMillion: parsePriceCell(cachedRaw),
        outputPerMillion: parsePriceCell(outputRaw),
      });
    }
  }

  if (!rows.length) {
    throw new Error('Standard pricing rows in API-Price.md are empty');
  }

  return rows.sort((a, b) => b.modelKey.length - a.modelKey.length);
}

export function getStandardPricing() {
  if (!standardPricingCache) {
    const markdown = readFileSync(API_PRICE_PATH, 'utf8');
    standardPricingCache = parseStandardPricingRows(markdown);
  }
  return standardPricingCache;
}

export function resolveModelPricing(modelName) {
  const normalized = normalizeModelLabel(modelName);
  const pricingRows = getStandardPricing();

  for (const row of pricingRows) {
    if (normalized === row.modelKey || normalized.startsWith(`${row.modelKey}-`)) {
      return { ...row, matchedModel: row.label };
    }
  }

  return null;
}

export function extractUsageBreakdown(usage) {
  const inputTotal = Number(usage?.input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  const cached = Number(usage?.input_tokens_details?.cached_tokens ?? 0);
  const inputCached = Math.min(Math.max(cached, 0), inputTotal);
  const inputCacheMiss = Math.max(inputTotal - inputCached, 0);

  return {
    inputCached,
    inputCacheMiss,
    output,
  };
}

export function calculateConsume(modelName, usage) {
  const breakdown = extractUsageBreakdown(usage);
  const pricing = resolveModelPricing(modelName);

  if (!pricing || pricing.inputPerMillion == null || pricing.outputPerMillion == null) {
    return {
      model: modelName,
      pricingModel: pricing?.matchedModel ?? null,
      pricingFound: false,
      ...breakdown,
      costUsd: null,
      rates: null,
    };
  }

  const cachedRate =
    pricing.cachedInputPerMillion ?? pricing.inputPerMillion;

  const costUsd =
    (breakdown.inputCacheMiss / 1_000_000) * pricing.inputPerMillion +
    (breakdown.inputCached / 1_000_000) * cachedRate +
    (breakdown.output / 1_000_000) * pricing.outputPerMillion;

  return {
    model: modelName,
    pricingModel: pricing.matchedModel,
    pricingFound: true,
    ...breakdown,
    costUsd,
    rates: {
      inputPerMillion: pricing.inputPerMillion,
      cachedInputPerMillion: cachedRate,
      outputPerMillion: pricing.outputPerMillion,
    },
  };
}

export function mergeConsumeTotals(current, next) {
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
