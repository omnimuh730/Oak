import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  AI_PORT,
  FILE_PATH,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  PROFILE_PATH,
  RUNTIME_FILE_KEY,
} from './config.js';
import { requestOptionMatch } from './match-option.js';
import { requestActionPlan } from './openai.js';
import { buildAnalyzePrompt } from './prompt.js';

const EMPTY_PROFILE_NOTE =
  'No applicant profile provided. Use {{PLACEHOLDER}} values for any required applicant data.';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
    profilePath: PROFILE_PATH,
    filePath: FILE_PATH,
  });
});

app.get('/api/runtime-file', async (_req, res) => {
  if (!FILE_PATH) {
    res.status(404).json({
      error: 'FILE_PATH is not set in .env',
    });
    return;
  }

  try {
    const buffer = await readFile(FILE_PATH);
    res.json({
      file: {
        key: RUNTIME_FILE_KEY,
        name: path.basename(FILE_PATH),
        mimeType: mimeTypeForPath(FILE_PATH),
        base64: buffer.toString('base64'),
      },
    });
  } catch (err) {
    res.status(404).json({
      error: `Runtime file not found at ${FILE_PATH}`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/match-option', async (req, res) => {
  try {
    const {
      intendedValue,
      options,
      fieldLabel = null,
      typedQuery = null,
    } = req.body ?? {};

    if (!intendedValue || typeof intendedValue !== 'string') {
      res.status(400).json({ error: 'intendedValue is required' });
      return;
    }
    if (!Array.isArray(options) || options.length === 0) {
      res.status(400).json({ error: 'options must be a non-empty string array' });
      return;
    }

    const result = await requestOptionMatch({
      intendedValue,
      options,
      fieldLabel,
      typedQuery,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/ai-analyze', async (req, res) => {
  try {
    const { pureTree, metaTree, page = null } = req.body ?? {};

    if (!pureTree || typeof pureTree !== 'string') {
      res.status(400).json({ error: 'pureTree is required' });
      return;
    }
    if (!metaTree || typeof metaTree !== 'string') {
      res.status(400).json({ error: 'metaTree is required' });
      return;
    }

    const applicantProfile = await readApplicantProfile();
    const { systemPrompt, userPrompt } = buildAnalyzePrompt({
      applicantProfile,
      pureTree,
      metaTree,
      page,
    });

    const result = await requestActionPlan(systemPrompt, userPrompt);

    res.json({
      ok: true,
      plan: result.plan,
      model: result.model,
      responseId: result.responseId,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function readApplicantProfile() {
  try {
    const text = await readFile(PROFILE_PATH, 'utf8');
    const trimmed = text.trim();
    return trimmed || EMPTY_PROFILE_NOTE;
  } catch {
    return EMPTY_PROFILE_NOTE;
  }
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return map[ext] || 'application/octet-stream';
}

app.listen(AI_PORT, () => {
  console.log(`Oak AI backend listening on http://localhost:${AI_PORT}`);
});
