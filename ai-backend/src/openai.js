import {
  OPENAI_API_URL,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  OPENAI_TEMPERATURE,
  requireOpenAiApiKey,
} from './config.js';
import { summarizeUsage } from './pricing.js';
import { ACTION_PLAN_FORMAT } from './schema.js';

export async function requestActionPlan(systemPrompt, userPrompt) {
  const apiKey = requireOpenAiApiKey();

  const body = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userPrompt }],
      },
    ],
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    text: {
      format: ACTION_PLAN_FORMAT,
    },
  };

  // Reasoning models often reject temperature; only set it when effort is unset.
  if (OPENAI_REASONING_EFFORT) {
    body.reasoning = { effort: OPENAI_REASONING_EFFORT };
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
    throw new Error('OpenAI returned empty output');
  }

  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new Error('OpenAI returned non-JSON output');
  }

  validatePlanShape(plan);

  const model = data.model || OPENAI_MODEL;
  return {
    plan,
    model,
    responseId: data.id || null,
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

function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Plan must be a JSON object');
  }
  for (const key of ['goal', 'actions', 'forbidden_actions', 'validation', 'unresolved_items']) {
    if (!(key in plan)) {
      throw new Error(`Plan missing required field: ${key}`);
    }
  }
  if (!Array.isArray(plan.actions) || !Array.isArray(plan.forbidden_actions)) {
    throw new Error('Plan actions and forbidden_actions must be arrays');
  }
  if (!plan.validation || typeof plan.validation !== 'object') {
    throw new Error('Plan validation must be an object');
  }
  if (!Array.isArray(plan.validation.required_element_indexes)) {
    throw new Error('validation.required_element_indexes must be an array');
  }
  if (typeof plan.validation.stop_before_submit !== 'boolean') {
    throw new Error('validation.stop_before_submit must be a boolean');
  }
  if (!Array.isArray(plan.unresolved_items)) {
    throw new Error('unresolved_items must be an array');
  }
}
