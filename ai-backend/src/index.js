import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.AI_PORT || 3848;
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const RESUME_KEY = process.env.RESUME_FILE_KEY || 'eli_taylor';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROFILE_PATH = resolveFromRepo(process.env.PROFILE_FILE_PATH || 'profile.md');
const RESUME_PATH = resolveFromRepo(process.env.RESUME_FILE_PATH || 'Eli Taylor.docx');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    model: OPENAI_MODEL,
    profilePath: PROFILE_PATH,
    resumeKey: RESUME_KEY,
  });
});

app.get('/api/resume-attachment', async (_req, res) => {
  try {
    const buffer = await readFile(RESUME_PATH);
    res.json({
      file: {
        key: RESUME_KEY,
        name: path.basename(RESUME_PATH),
        mimeType: mimeTypeForPath(RESUME_PATH),
        base64: buffer.toString('base64'),
      },
      note:
        'This file is for Oak Script Eval runtime only. It is not included in the AI prompt.',
    });
  } catch (err) {
    res.status(404).json({
      error: `Resume attachment not found at ${RESUME_PATH}`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/generate-eval-script', async (req, res) => {
  try {
    const { analyzeText, page = {}, resumeKey = RESUME_KEY } = req.body ?? {};
    if (!analyzeText || typeof analyzeText !== 'string') {
      res.status(400).json({ error: 'analyzeText is required' });
      return;
    }

    const profileText = await readProfile();
    const { systemPrompt, userPrompt } = buildEvalScriptPrompt({
      analyzeText,
      profileText,
      page,
      resumeKey,
    });

    const ai = await requestEvalScript(systemPrompt, userPrompt);
    const code = extractJavaScript(ai.text);

    res.json({
      ok: true,
      code,
      responseId: ai.responseId,
      model: OPENAI_MODEL,
      resumeKey,
      promptInputs: {
        analyzeText: 'Copy for Analyze DOM text',
        profile: path.basename(PROFILE_PATH),
        resume:
          `not sent to AI; generated code should use attachDroppedFile(input, '${resumeKey}')`,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/api/repair-eval-script', async (req, res) => {
  try {
    const {
      analyzeText,
      page = {},
      resumeKey = RESUME_KEY,
      previousResponseId,
      currentCode,
      evalResult,
      evalError,
    } = req.body ?? {};

    if (!currentCode || typeof currentCode !== 'string') {
      res.status(400).json({ error: 'currentCode is required' });
      return;
    }
    if (!evalResult && !evalError) {
      res.status(400).json({ error: 'evalResult or evalError is required' });
      return;
    }

    const profileText = previousResponseId ? '' : await readProfile();
    const { systemPrompt, userPrompt } = buildRepairEvalScriptPrompt({
      analyzeText,
      profileText,
      page,
      resumeKey,
      currentCode,
      evalResult,
      evalError,
      hasPreviousResponse: Boolean(previousResponseId),
    });

    const ai = await requestEvalScript(systemPrompt, userPrompt, {
      previousResponseId,
    });
    const code = extractJavaScript(ai.text);

    res.json({
      ok: true,
      code,
      responseId: ai.responseId,
      model: OPENAI_MODEL,
      previousResponseId: previousResponseId || null,
      resumeKey,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

function resolveFromRepo(value) {
  return path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
}

async function readProfile() {
  try {
    return await readFile(PROFILE_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Unable to read profile.md at ${PROFILE_PATH}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function buildEvalScriptPrompt({ analyzeText, profileText, page, resumeKey }) {
  const systemPrompt = `
You are Oak's Eval Script Generator. Return only executable JavaScript source code, no Markdown fences, no prose, and no explanation.

The returned code is inserted as the body of an async function in Oak Script Eval. It can use await and must end by returning a concise result object or result string.

Runtime helpers available inside the code:
- __oak.byOakId(number): finds a DOM element by the node id from the Copy for Analyze tree.
- __oak.byId(string): finds an element by DOM id through shadow DOM when possible.
- __oak.queryDeep(root, selector): querySelector through shadow roots and same-origin iframes. It returns one element only.
- __oak.queryDeepAll(root, selector): querySelectorAll through shadow roots and same-origin iframes. It returns an array of elements.
- __oak.setValue(element, value): sets native input/textarea values and dispatches input/change/blur events.
- await __oak.selectByText(element, text): selects native <select> options by visible text and routes known fake dropdowns when possible.
- await __oak.clickIcimsDropdownOption(elementOrOakNodeId, text): opens an iCIMS dropdown and clicks a visible option by exact/near text.
- await __oak.selectWorkdayDropdownOption(elementOrOakNodeIdOrDomId, text): opens a Workday dropdown button with aria-haspopup="listbox" and clicks a visible option by exact/near text.
- __oak.setWorkdayDate(groupElementOrOakNodeIdOrDomId, month, year): fills Workday MM/YYYY date groups by setting the Month and Year spinbutton inputs.
- __oak.click(element): dispatches pointer/mouse/click events like a user click.
- __oak.waitFor(selectorOrFn, timeoutMs): waits for an element or condition.
- window.attachDroppedFile(input, '${resumeKey}'): attaches the Oak runtime file for Eli Taylor's resume/CV.

Critical resume rule:
- Do not ask for, read, parse, summarize, embed, or infer from the resume file.
- The resume file is not prompt context. It is already handled by Oak Script Eval as a runtime attachment with key "${resumeKey}".
- For a resume/CV/upload file input, generate only the code needed to find that specific input and call window.attachDroppedFile(input, '${resumeKey}').
- Never invent a local file path, fake base64, fake File content, or resume text.

Generation rules:
- Use the supplied Copy for Analyze DOM tree as the source of truth for actual fields and Oak node ids.
- Use profile.md as the source of truth for candidate values.
- Filling the resume upload alone is never sufficient unless the analyzed DOM truly contains no other visible editable, required, invalid, or validation-error fields.
- Treat visible error text such as "The field X is required and must have a value", aria-invalid="true", aria-required="true", required stars, and Workday/iCIMS alert nodes as high-priority fields to fill or report.
- Generate page-specific code for the actual form controls in this DOM tree. Do not generate a broad reusable autofill engine, giant field configuration array, mutation observer, or generic "Sample text" fallback.
- Handle every actual fillable control shown in the analyzed DOM: text inputs, email, phone, URL, textarea, select, radio, checkbox, combobox/autocomplete, and file upload.
- Never skip an actual form field. If a field has an explicit profile value or exact option answer, fill it. If a required acknowledgement/terms checkbox exists, check it. If an exact safe value cannot be determined, put that field in the returned missing array with its Oak node id and visible label instead of silently ignoring it.
- Prefer __oak.byOakId(nodeId) selectors from the tree. Use CSS selectors only as a backup.
- Prefer the analyzed control/container Oak node ids over hardcoded long question text searches. Do not locate fields with broad loops such as document.querySelectorAll('button').find(...includes(fullQuestionText)) when the tree provides a node id for the field, button, input, or fieldset.
- Only push an item into filled after the actual fill call returns true or a direct DOM verification confirms the value/checked/selected state changed. If a helper returns false, push that field into missing with its Oak node id and visible label.
- For Workday date groups that show MM/YYYY, call __oak.setWorkdayDate(groupElementOrOakNodeIdOrDomId, month, year). Use 1-12 month numbers such as "2" and four-digit years such as "2026".
- For Workday dropdown buttons, fieldsets, or containers that show button[aria-haspopup="listbox"], use await __oak.selectWorkdayDropdownOption(nodeOrElement, exactVisibleOptionText). Do not use __oak.clickIcimsDropdownOption for Workday controls.
- For Work Experience fields, use profile.md autoBidProfile.careers. Use the first career entry for Work Experience 1 unless the DOM clearly asks for another entry. If endPresent is true, check "I currently work here" and do not invent a To date; otherwise fill To month/year.
- For Education fields, use profile.md autoBidProfile.education. Map "School or University" to school, "Degree" to diploma, and date fields to start/end month/year.
- For native selects, use await __oak.selectByText(selectEl, exactVisibleText).
- For iCIMS dropdowns only, do not type into the search input and do not hand-roll queryDeepAll loops unless absolutely necessary. Use await __oak.clickIcimsDropdownOption(selectElOrComboboxOrSearchInputOrOakNodeId, exactVisibleOptionText). The analyzed tree often shows a hidden select, an <a role="combobox">, an input.dropdown-search, and <li role="option"> nodes; pick the real option text from the tree and call the helper.
- For radios/checkboxes, click the exact option/control. Dispatch pointer/mouse/click/input/change events as needed.
- Do not click final Submit/Apply/Send buttons. It is okay to click a non-final Next/Continue/Save and Continue button only when the DOM clearly represents a multi-step form and current fields are filled.
- Keep the script narrowly focused on filling the current application form. No network requests, no localStorage scraping, no navigation away from the page, no unrelated logging.
- Always return a result object like { ok: true, filled: [...], missing: [] }. Never allow the script to return undefined.
`.trim();

  const userPrompt = `
Page:
${JSON.stringify(page, null, 2)}

profile.md:
${profileText}

Copy for Analyze DOM tree:
${analyzeText}

Generate the Oak Script Eval JavaScript body now. Remember: profile.md plus the analyzed DOM are prompt context; the resume is runtime-only and must be referenced with key "${resumeKey}".
`.trim();

  return { systemPrompt, userPrompt };
}

function buildRepairEvalScriptPrompt({
  analyzeText,
  profileText,
  page,
  resumeKey,
  currentCode,
  evalResult,
  evalError,
  hasPreviousResponse,
}) {
  const systemPrompt = `
You are Oak's Eval Script Repair Generator. Return only executable JavaScript source code, no Markdown fences, no prose, and no explanation.

You are continuing from the previous AI generation when previous_response_id is provided. The user ran the script and is giving you the result/error. Generate a full replacement Script Eval body, but change only the logic needed to fix failed or missing fields. Preserve successful field behavior. Do not refactor unrelated working sections.

Runtime helpers now available:
- __oak.byOakId(number)
- __oak.queryDeep(root, selector) returns one element.
- __oak.queryDeepAll(root, selector) returns an array.
- __oak.setValue(element, value)
- await __oak.selectByText(element, text)
- await __oak.clickIcimsDropdownOption(elementOrOakNodeId, text)
- await __oak.selectWorkdayDropdownOption(elementOrOakNodeIdOrDomId, text)
- __oak.setWorkdayDate(groupElementOrOakNodeIdOrDomId, month, year)
- __oak.click(element)
- __oak.waitFor(selectorOrFn, timeoutMs)
- window.attachDroppedFile(input, '${resumeKey}')

Repair rules:
- If the result has missing fields that are actually available in profile.md and the analyzed DOM, fix those fields.
- If fresh post-run Analyze DOM contains visible validation errors, aria-invalid="true", or required empty fields, treat the previous run as failed even if its JSON said { ok: true, missing: [] }.
- Filling the resume upload alone is never enough when the fresh Analyze DOM still contains Work Experience, Education, or other required validation errors.
- If a missing field has no source value in profile.md, keep it in missing and do not invent a value.
- Fix dishonest success reporting: do not add a field to filled unless its helper/setter returned true or the DOM verifies the value/checked/selected state changed. If a fill attempt fails, add that field to missing.
- Prefer the analyzed control/container Oak node ids over hardcoded long question text searches. Do not locate fields with broad loops such as document.querySelectorAll('button').find(...includes(fullQuestionText)) when the tree provides a node id for the field, button, input, or fieldset.
- For Workday date groups that show MM/YYYY, call __oak.setWorkdayDate(groupElementOrOakNodeIdOrDomId, month, year). If the profile career has endPresent=true, check "I currently work here" instead of inventing a To date.
- For Workday dropdown buttons, fieldsets, or containers that show button[aria-haspopup="listbox"], use await __oak.selectWorkdayDropdownOption(nodeOrElement, exactVisibleOptionText). Do not use __oak.clickIcimsDropdownOption for Workday controls.
- For Work Experience, use profile.md autoBidProfile.careers. For Education, use profile.md autoBidProfile.education.
- For iCIMS dropdowns only, use __oak.selectByText or __oak.clickIcimsDropdownOption with exact visible option text from the DOM. Do not type into dropdown-search as the primary strategy.
- Always return { ok: true, filled: [...], missing: [...] }. Never return undefined.
`.trim();

  const context = `
Page:
${JSON.stringify(page, null, 2)}

${hasPreviousResponse ? 'Use the profile.md candidate values from the previous response context.' : `profile.md:\n${profileText}`}

Fresh post-run Copy for Analyze DOM tree:
${analyzeText || '(not supplied)'}
`;

  const userPrompt = `
The previous Script Eval result/error was:
${evalError ? `ERROR:\n${evalError}` : `RESULT:\n${evalResult}`}

Current generated script:
${currentCode}

${context}

Generate the repaired full JavaScript body now. Preserve working fills and only fix the result issue. Remember: the resume is runtime-only with key "${resumeKey}".
`.trim();

  return { systemPrompt, userPrompt };
}

async function requestEvalScript(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for ai-backend');
  }

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
    temperature: Number(process.env.OPENAI_TEMPERATURE || 0.1),
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12000),
  };

  if (options.previousResponseId) {
    body.previous_response_id = options.previousResponseId;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.error?.message || `OpenAI request failed with HTTP ${response.status}`,
    );
  }

  const text = extractOutputText(data);
  if (!text.trim()) {
    throw new Error('OpenAI returned an empty eval script');
  }
  return {
    text,
    responseId: typeof data?.id === 'string' ? data.id : null,
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;

  const chunks = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n');
}

function extractJavaScript(rawOutput) {
  const trimmed = rawOutput.trim();
  const fenced = trimmed.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  const code = (fenced ? fenced[1] : trimmed).trim();

  if (!code) throw new Error('Generated eval script is empty');
  if (!/\b(__oak|document|window)\b/.test(code)) {
    throw new Error('Generated eval script does not appear to target the page DOM');
  }
  return code;
}

function mimeTypeForPath(filePath) {
  if (/\.docx$/i.test(filePath)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (/\.pdf$/i.test(filePath)) return 'application/pdf';
  return 'application/octet-stream';
}

app.listen(PORT, () => {
  console.log(`Oak AI backend listening on http://localhost:${PORT}`);
  console.log(`Profile prompt source: ${PROFILE_PATH}`);
  console.log(`Resume runtime attachment key: ${RESUME_KEY}`);
});
