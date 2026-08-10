import cors from 'cors';
import express from 'express';
import { readFile } from 'node:fs/promises';
import {
  AI_PORT,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
  PROFILE_PATH,
} from './config.js';
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
  });
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

app.listen(AI_PORT, () => {
  console.log(`Oak AI backend listening on http://localhost:${AI_PORT}`);
});
