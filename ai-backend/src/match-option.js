import {
  OPENAI_API_URL,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  OPENAI_TEMPERATURE,
  requireOpenAiApiKey,
} from './config.js';
import { summarizeUsage } from './pricing.js';

const MATCH_OPTION_FORMAT = {
  type: 'json_schema',
  name: 'oak_option_match',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matched_option: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['matched_option', 'confidence', 'reason'],
  },
};

const SYSTEM_PROMPT = `You match an intended form answer to one visible dropdown option.

Rules:
1. Return matched_option as an EXACT copy of one string from the provided options list, or null.
2. Prefer semantic equivalence over wording (e.g. "I am not a protected veteran" may match "No, I am not a veteran or active member").
3. Never invent, paraphrase, or alter an option string.
4. If no option is a reasonable match, return matched_option null.
5. confidence is 0–1.`;

export async function requestOptionMatch({
  intendedValue,
  options,
  fieldLabel = null,
  typedQuery = null,
}) {
  const apiKey = requireOpenAiApiKey();
  const list = Array.isArray(options) ? options.filter((o) => typeof o === 'string' && o.trim()) : [];

  if (!intendedValue || !list.length) {
    return { matched_option: null, confidence: 0, reason: 'Missing value or options', model: OPENAI_MODEL };
  }

  const userPrompt = [
    fieldLabel ? `Field label: ${fieldLabel}` : null,
    typedQuery ? `Current typed filter: ${typedQuery}` : null,
    `Intended answer: ${intendedValue}`,
    'Visible options:',
    ...list.map((opt, i) => `${i + 1}. ${opt}`),
    'Pick the best matching option string exactly, or null.',
  ]
    .filter(Boolean)
    .join('\n');

  const body = {
    model: OPENAI_MODEL,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
    ],
    max_output_tokens: 400,
    text: { format: MATCH_OPTION_FORMAT },
  };

  if (OPENAI_REASONING_EFFORT) {
    body.reasoning = { effort: OPENAI_REASONING_EFFORT === 'xhigh' ? 'high' : OPENAI_REASONING_EFFORT };
    // Prefer fast matching; clamp heavy reasoning for this small task.
    if (['high', 'xhigh', 'medium'].includes(OPENAI_REASONING_EFFORT)) {
      body.reasoning = { effort: 'low' };
    }
  } else {
    body.temperature = OPENAI_TEMPERATURE;
  }

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : `OpenAI request failed: ${res.status}`;
    throw new Error(detail);
  }

  const text = extractOutputText(data);
  if (!text?.trim()) {
    throw new Error('OpenAI returned empty output for option match');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI returned non-JSON option match');
  }

  let matched = typeof parsed.matched_option === 'string' ? parsed.matched_option : null;
  if (matched && !list.includes(matched)) {
    // Allow case-insensitive exact recovery; otherwise reject invented strings.
    const recovered = list.find((opt) => opt.toLowerCase() === matched.toLowerCase());
    matched = recovered || null;
  }

  const model = data.model || OPENAI_MODEL;
  return {
    matched_option: matched,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    model,
    usage: summarizeUsage(data.usage, model),
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const chunks = [];
  for (const item of data?.output ?? []) {
    if (item?.type === 'refusal') {
      throw new Error(item.refusal || 'OpenAI refused the request');
    }
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n');
}
