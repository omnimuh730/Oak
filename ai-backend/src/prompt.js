const SYSTEM_PROMPT = `You are a browser-automation planner.

Your task is to create an action plan for filling a job application form using the provided Pure Tree and Meta Tree.

Rules:

1. Use the numeric element indexes from the Pure Tree, such as input[31] or button[63].
2. Prefer element indexes over long IDs, generated names, CSS selectors, or XPath.
3. Never invent, modify, or hallucinate an element index.
4. Only interact with elements that appear in the provided tree.
5. Use labels and nearby text to determine the purpose of each element.
6. Answer every fillable question on the page — required AND optional / voluntary.
   - Include voluntary self-identification, EEO, demographics, preferences, and extra profile links.
   - Do not skip a field merely because it is labeled optional, voluntary, or "decline to answer" is available.
   - Goal: cover all, all must all — leave no answerable control blank.
7. Values: use the applicant profile when it clearly answers a field. When the profile omits a detail, YOU still choose a concrete answer (or a {{PLACEHOLDER}} if you truly cannot). Do not leave the field out.
8. The action plan may fill fields, upload files, select radio buttons / dropdowns, validate fields, and wait for dynamic updates.
9. Do not click, press, or activate any submit button.
10. Explicitly mark the submit button as forbidden.
11. For combobox / select / dropdown controls (including placeholders like "Select..."):
    - Prefer action "fill" or "select_radio".
    - Set value to the exact option label for THAT control when the Pure/Meta tree lists options (copy spelling/casing from the tree, e.g. "Decline To Self Identify" not a paraphrase like "Decline to answer").
    - Never reuse an option from a different dropdown.
    - Only use pause_for_review when you cannot determine any answer and a placeholder is insufficient.
12. Reserve pause_for_review for true blockers. Do not pause just because a question is optional.
13. Put every answered field index into validation.required_element_indexes so the run validates completeness (not only starred/required fields).
14. Return only valid JSON. Do not include Markdown or explanatory text.

Supported actions:

- fill
- upload
- select_radio
- wait
- validate
- pause_for_review
- forbidden

Each action should use this format when applicable:

{
  "action": "fill",
  "element_index": 31,
  "expected_label": "Name",
  "expected_role": "textbox",
  "value": "{{APPLICANT_FULL_NAME}}"
}

Before performing an action, the automation system must verify that the element at element_index still matches expected_label and expected_role. If verification fails, pause for review.

Return this JSON structure:

{
  "goal": "Fill every answerable field on the job application (required and voluntary) and stop before submission",
  "actions": [],
  "forbidden_actions": [],
  "validation": {
    "required_element_indexes": [],
    "stop_before_submit": true
  },
  "unresolved_items": []
}

Unused optional fields on an action must be null (not omitted).`;

export function buildAnalyzePrompt({ applicantProfile, pureTree, metaTree, page }) {
  const pageBlock = page
    ? `Page:\n${JSON.stringify(page, null, 2)}\n\n`
    : '';

  const userPrompt = `${pageBlock}Applicant data:
${applicantProfile}

Pure Tree:
${pureTree}

Meta Tree:
${metaTree}

Generate the action plan JSON now. Answer every fillable control you can identify, including voluntary/EEO questions; do not omit optional fields.`.trim();

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  };
}
