import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

// Prefer repo-root .env; fall back to process cwd.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config();

export const AI_PORT = Number(process.env.AI_PORT || 3848);
export const OPENAI_API_URL =
  process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
export const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE || 0.1);
export const OPENAI_MAX_OUTPUT_TOKENS = Number(
  process.env.OPENAI_MAX_OUTPUT_TOKENS || 12000,
);
export const OPENAI_REASONING_EFFORT = normalizeReasoningEffort(
  process.env.OPENAI_REASONING_EFFORT,
);

export const PROFILE_PATH = resolveFromRepo(
  process.env.PROFILE_FILE_PATH || 'profile.md',
);

export function resolveFromRepo(value) {
  return path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
}

export function requireOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required (set it in repo-root .env)');
  }
  return apiKey;
}

function normalizeReasoningEffort(value) {
  if (value == null || String(value).trim() === '') return null;
  const effort = String(value).trim().toLowerCase();
  const allowed = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  if (!allowed.has(effort)) {
    throw new Error(
      `Invalid OPENAI_REASONING_EFFORT="${value}". Use one of: none, minimal, low, medium, high, xhigh`,
    );
  }
  return effort;
}
