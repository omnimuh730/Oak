import { formatDuration, formatUsd } from '../../../shared/ai-usage';
import { applyApplicantIdentityToActions } from '../../../shared/plan-runner/applicant-identity';
import { runActionPlan } from '../../../shared/plan-runner/orchestrator';
import { executionIndexOrder } from '../../../shared/plan-runner/step-file';
import type {
  ActionPlan,
  PauseRequest,
  PlanStepPayload,
  RunStepRecord,
} from '../../../shared/plan-runner/types';
import type { PipelineProgress } from '../../../shared/pipeline-types';
import {
  formatMetaTreePreview,
  formatPureTreePreview,
  splitDomTree,
} from '../../../shared/tree-export';
import { sendPlanStepToTab, sendTabMessage } from '../tab-messaging';
import { getTabJob } from '../tab-job-session';
import { DEFAULT_AI_SERVER, MSG, type DomNode, type DomTreePayload } from '../types';
import { fetchRuntimeFile, requestAiAnalyze } from './ai-client';
import { keepResumeIfSameSite, loadFillResume } from './fill-resume';
import { buildResumeUploadProgress } from './resume-upload-status';
import {
  addPipelineUsage,
  beginPipelineUsageTracking,
  endPipelineUsageTracking,
} from './usage-tracker';

export type PipelineEmit = (progress: PipelineProgress) => void;

export interface RunPipelineArgs {
  /** Pinned at Fill click. DOM fetch and every plan step target this tab, even if the user focuses another. */
  tabId: number;
  preferredFrameId?: number | null;
  aiServerUrl?: string;
  /** Emit DOM tree to backend for UI board (optional socket emit callback). */
  emitDomTree?: (payload: DomTreePayload) => void;
  /** Broadcast progress to the Chrome side panel + backend. */
  onProgress: PipelineEmit;
}

function shortLabel(expectedLabel: string | null | undefined, action: string): string {
  const label = (expectedLabel || '').trim();
  if (!label) return action;
  return label.length > 36 ? `${label.slice(0, 33)}…` : label;
}

/**
 * Unattended pause policy for FAB pipeline:
 * - errors → always skip (Continue/Abort stay available for UI board)
 * - planned pause → continue so autofill can run when a value is present
 */
async function autoPauseDecision(request: PauseRequest) {
  if (request.kind === 'error') return 'skip' as const;
  return 'continue' as const;
}

async function fetchDomFromTab(
  tabId: number,
  preferredFrameId?: number | null,
): Promise<DomTreePayload> {
  const tried = new Set<number>();

  const attempt = async (frameId?: number) => {
    if (frameId != null) {
      if (tried.has(frameId)) return null;
      tried.add(frameId);
    }
    return sendTabMessage<
      DomTreePayload & { error?: string; skipped?: boolean; formScore?: number }
    >(tabId, { type: MSG.FETCH_DOM }, frameId);
  };

  type Candidate = DomTreePayload & { formScore: number };
  const candidates: Candidate[] = [];

  const consider = (
    res: (DomTreePayload & { error?: string; skipped?: boolean; formScore?: number }) | null,
    frameId: number,
  ) => {
    if (!res?.tree || res.error) return;
    candidates.push({
      ...res,
      tabId,
      frameId,
      formScore: typeof res.formScore === 'number' ? res.formScore : 0,
    });
  };

  let frameList: Array<{ frameId: number; url?: string; parentFrameId?: number }> = [
    { frameId: 0 },
  ];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames?.length) {
      frameList = frames.map((f) => ({
        frameId: f.frameId,
        url: f.url,
        parentFrameId: f.parentFrameId,
      }));
    }
  } catch {
    // restricted pages — fall back to main frame only
  }

  if (preferredFrameId != null) {
    consider(await attempt(preferredFrameId), preferredFrameId);
  }
  for (const frame of frameList) {
    consider(await attempt(frame.frameId), frame.frameId);
  }

  if (!candidates.length) {
    throw new Error(
      'Could not fetch DOM from any frame. Reload the extension and refresh the page.',
    );
  }

  candidates.sort((a, b) => {
    if (b.formScore !== a.formScore) return b.formScore - a.formScore;
    if (a.frameId === preferredFrameId) return -1;
    if (b.frameId === preferredFrameId) return 1;
    // Prefer nested frames over shell when scores tie.
    return (b.frameId ?? 0) - (a.frameId ?? 0);
  });

  const picked = candidates[0];
  // #region agent log
  fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '543c46',
    },
    body: JSON.stringify({
      sessionId: '543c46',
      runId: 'post-fix',
      hypothesisId: 'F',
      location: 'run-pipeline.ts:fetchDom',
      message: 'picked form frame',
      data: {
        frameCount: frameList.length,
        candidateCount: candidates.length,
        preferredFrameId: preferredFrameId ?? null,
        pickedFrameId: picked.frameId ?? null,
        pickedScore: picked.formScore,
        scores: candidates.slice(0, 8).map((c) => ({
          frameId: c.frameId ?? null,
          formScore: c.formScore,
        })),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return picked;
}

export async function runFabPipeline(args: RunPipelineArgs): Promise<void> {
  const {
    tabId,
    preferredFrameId = null,
    aiServerUrl = DEFAULT_AI_SERVER,
    emitDomTree,
    onProgress,
  } = args;

  const startedAt = Date.now();
  beginPipelineUsageTracking(tabId);

  let treeSnapshot: PipelineProgress['tree'];
  let planSnapshot: ActionPlan | undefined;
  let stepsSnapshot: RunStepRecord[] | undefined;

  const emit: PipelineEmit = (progress) => {
    if (progress.tree) treeSnapshot = progress.tree;
    if (progress.plan) planSnapshot = progress.plan;
    if (progress.steps) stepsSnapshot = progress.steps;
    onProgress(progress);
  };

  const finishMeta = () => {
    const durationMs = Date.now() - startedAt;
    const usage = endPipelineUsageTracking(tabId);
    return { durationMs, usage };
  };

  try {
    emit({ phase: 'fetching', message: 'Fetching DOM…' });

    const tabJob = await getTabJob(tabId);
    const [treePayload, resumeLoad, runtimeFile] = await Promise.all([
      fetchDomFromTab(tabId, preferredFrameId),
      loadFillResume({ tabJob, apiUrl: aiServerUrl }),
      fetchRuntimeFile(aiServerUrl).catch(() => null),
    ]);
    const boundResume = keepResumeIfSameSite(
      resumeLoad.file,
      tabJob,
      treePayload.url,
      resumeLoad.skipReason,
    );
    const recommendedResume = boundResume.file;
    const resumeSkipReason = boundResume.skipReason;
    emitDomTree?.(treePayload);
    treeSnapshot = {
      url: treePayload.url,
      title: treePayload.title,
      tree: treePayload.tree,
      fetchedAt: treePayload.fetchedAt,
    };

    const resumeUpload = () =>
      buildResumeUploadProgress({
        recommendedResume,
        resumeStack: tabJob?.resumeStack ?? null,
        skipReason: resumeSkipReason,
        steps: stepsSnapshot,
      });

    const nodeCount = countDomNodes(treePayload.tree);
    emit({
      phase: 'analyzing',
      message: recommendedResume
        ? `Analyzing ${nodeCount} nodes · resume ${recommendedResume.label || recommendedResume.name}`
        : tabJob?.resumeStack
          ? `Analyzing ${nodeCount} nodes · ${tabJob.resumeStack} file unavailable`
          : `Analyzing ${nodeCount} nodes…`,
      tree: treeSnapshot,
      resumeUpload: resumeUpload(),
    });

    const split = splitDomTree(treePayload.tree);
    const pureTree = formatPureTreePreview(split.pure);
    const metaTree = formatMetaTreePreview(split.meta, split.pure);

    const analyze = await requestAiAnalyze(
      {
        pureTree,
        metaTree,
        page: {
          title: treePayload.title || 'Untitled',
          url: treePayload.url,
          fetchedAt: treePayload.fetchedAt,
          job: tabJob
            ? {
                id: tabJob.jobId,
                title: tabJob.title,
                company: tabJob.company,
              }
            : null,
          recommendedResumeAvailable: Boolean(recommendedResume),
          recommendedResumeStack:
            recommendedResume?.label || tabJob?.resumeStack || null,
        },
      },
      aiServerUrl,
    );
    addPipelineUsage(tabId, analyze.usage);

    const plan = analyze.plan as ActionPlan;
    applyApplicantIdentityToActions(plan.actions);
    planSnapshot = plan;
    const stepTotal = plan.actions?.length ?? 0;
    // #region agent log
    {
      const actions = plan.actions ?? [];
      const labelOf = (action: (typeof actions)[number]) =>
        String(action.expected_label || '');
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '543c46',
        },
        body: JSON.stringify({
          sessionId: '543c46',
          runId: 'post-fix',
          hypothesisId: 'G',
          location: 'run-pipeline.ts:plan',
          message: 'analyze plan summary',
          data: {
            actionCount: actions.length,
            resumeUpload: actions.filter((a) => a.action === 'resume_upload').length,
            upload: actions.filter((a) => a.action === 'upload').length,
            fill: actions.filter((a) => a.action === 'fill').length,
            fileUploadIndexes: actions
              .map((a, i) =>
                a.action === 'upload' || a.action === 'resume_upload' ? i : -1,
              )
              .filter((i) => i >= 0),
            execOrderHead: executionIndexOrder(actions).slice(0, 6),
            stateLike: actions.filter((a) =>
              /state|province|region/i.test(labelOf(a)),
            ).length,
            countryLike: actions.filter((a) => /country|nation/i.test(labelOf(a)))
              .length,
            resumeLike: actions.filter((a) =>
              /resume|cv|curriculum/i.test(labelOf(a)),
            ).length,
            selfIdLike: actions.filter((a) =>
              /race|ethnic|hispanic|gender|veteran|disabilit/i.test(labelOf(a)),
            ).length,
            treeHasRace: /identify your race|\brace\b/i.test(pureTree),
            treeHasGender: /\bgender\b/i.test(pureTree),
            treeHasHispanic: /hispanic/i.test(pureTree),
            treeHasPreEmployment: /pre-?employment/i.test(pureTree),
            comboRoleCount: (pureTree.match(/role=combobox/gi) || []).length,
            pureChars: pureTree.length,
            unresolved: (plan.unresolved_items || []).length,
            countryIndex: actions.findIndex((a) =>
              /country|nation/i.test(labelOf(a)),
            ),
            stateIndex: actions.findIndex((a) =>
              /state|province|region/i.test(labelOf(a)),
            ),
            hasResumeFile: Boolean(recommendedResume),
            aiToolLike: actions
              .filter((a) =>
                /\b(ai|artificial intelligence|automated employment|automated decision|automated screening|automated tool)\b/i.test(
                  labelOf(a),
                ),
              )
              .map((a) => ({
                action: a.action,
                labelLen: labelOf(a).length,
                intendedPreview: /^(yes|no|true|false)$/i.test(
                  String(a.value || '').trim(),
                )
                  ? String(a.value).trim()
                  : undefined,
                intendedLen: String(a.value || '').length,
              })),
            yesNoSteps: actions
              .filter((a) => /^(yes|no)$/i.test(String(a.value || '').trim()))
              .map((a) => ({
                action: a.action,
                preview: String(a.value).trim(),
                labelLen: labelOf(a).length,
              })),
            emptyFieldSuspects: actions
              .filter((a) =>
                /password|e-?mail|preferred|consent|text message|sms/i.test(
                  labelOf(a),
                ),
              )
              .map((a) => ({
                action: a.action,
                labelLen: labelOf(a).length,
                intendedLen: String(a.value || '').length,
                password: /password/i.test(labelOf(a)),
                email: /e-?mail/i.test(labelOf(a)),
                preferred: /preferred/i.test(labelOf(a)),
                sms: /text message|sms|consent to receive/i.test(labelOf(a)),
              })),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion

    emit({
      phase: 'running',
      message: stepTotal ? `Running 0/${stepTotal}…` : 'Running…',
      stepIndex: 0,
      stepTotal,
      plan,
      resumeUpload: resumeUpload(),
    });

    const frameId = treePayload.frameId ?? preferredFrameId ?? null;

    const report = await runActionPlan({
      plan,
      runtimeFile,
      recommendedResume,
      executeStep: async (step: PlanStepPayload) => {
        const res = await sendPlanStepToTab(tabId, step, frameId);
        const details = res.details ?? {};
        return {
          ok: Boolean(res.ok),
          verified: res.verified,
          acted: res.acted,
          alreadyFilled: Boolean(res.alreadyFilled),
          error: res.error,
          details: {
            nodeId: typeof details.nodeId === 'number' ? details.nodeId : undefined,
            matchedLabel:
              typeof details.matchedLabel === 'string' ? details.matchedLabel : undefined,
            matchedRole:
              typeof details.matchedRole === 'string' ? details.matchedRole : undefined,
            valueAfter: typeof details.valueAfter === 'string' ? details.valueAfter : undefined,
          },
        };
      },
      hooks: {
        onSteps: (steps) => {
          const running = steps.find((s) => s.status === 'running' || s.status === 'paused');
          const doneCount = steps.filter((s) =>
            ['ok', 'skipped', 'blocked', 'failed', 'aborted'].includes(s.status),
          ).length;
          const current = running ?? steps[Math.min(doneCount, steps.length - 1)];
          const idx = current ? current.index + 1 : doneCount;
          emit({
            phase: 'running',
            message: `Running ${Math.min(idx, stepTotal)}/${stepTotal}…`,
            stepIndex: current?.index,
            stepTotal,
            stepLabel: current
              ? shortLabel(current.expected_label, current.action)
              : undefined,
            steps,
            resumeUpload: buildResumeUploadProgress({
              recommendedResume,
              resumeStack: tabJob?.resumeStack ?? null,
              skipReason: resumeSkipReason,
              steps,
            }),
          });
        },
        onPause: async (request) => {
          emit({
            phase: 'running',
            message:
              request.kind === 'error'
                ? `Skipping: ${shortLabel(request.expected_label, request.action)}`
                : `Review: ${shortLabel(request.expected_label, request.action)}`,
            stepIndex: request.index,
            stepTotal,
            stepLabel: shortLabel(request.expected_label, request.action),
            resumeUpload: resumeUpload(),
          });
          return autoPauseDecision(request);
        },
      },
    });

    const { durationMs, usage } = finishMeta();
    const timeLabel = formatDuration(durationMs);
    const costLabel = formatUsd(usage?.costUsd);

    const doneResume = buildResumeUploadProgress({
      recommendedResume,
      resumeStack: tabJob?.resumeStack ?? null,
      skipReason: resumeSkipReason,
      steps: report.steps,
    });

    if (report.aborted) {
      emit({
        phase: 'error',
        message: `Aborted · ${timeLabel} · ${costLabel}`,
        error: 'Plan run aborted',
        stepTotal,
        durationMs,
        usage,
        tree: treeSnapshot,
        plan: planSnapshot,
        steps: report.steps,
        resumeUpload: doneResume,
      });
      return;
    }

    const { summary } = report;
    const resultLabel = report.ok
      ? `${summary.ok} ok`
      : `${summary.ok} ok, ${summary.skipped} skipped`;
    // #region agent log
    {
      const kind = (message?: string) => {
        const m = String(message || '');
        if (/no combobox option/i.test(m)) return 'no-combobox-match';
        if (/no select option/i.test(m)) return 'no-option';
        if (/file input/i.test(m)) return 'no-file-input';
        if (/role mismatch/i.test(m)) return 'role-mismatch';
        if (/label mismatch/i.test(m)) return 'label-mismatch';
        if (/already=/i.test(m) || /already filled/i.test(m)) return 'already-filled';
        if (/did not persist/i.test(m)) return 'upload-remount';
        if (/no combobox trigger/i.test(m)) return 'no-combobox';
        if (/verification failed|element not found|index not found/i.test(m)) {
          return 'verify-miss';
        }
        if (/timed out/i.test(m)) return 'timeout';
        if (/not a form frame/i.test(m)) return 'wrong-frame';
        return m ? 'other' : 'none';
      };
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '543c46',
        },
        body: JSON.stringify({
          sessionId: '543c46',
          runId: 'post-fix',
          hypothesisId: 'A',
          location: 'run-pipeline.ts:done',
          message: 'plan run summary',
          data: {
            ok: report.ok,
            aborted: report.aborted,
            summary,
            notOk: report.steps
              .filter((s) => s.status !== 'ok')
              .map((s) => ({
                action: s.action,
                status: s.status,
                kind: kind(s.message),
              })),
            resumeSteps: report.steps
              .filter(
                (s) =>
                  s.action === 'resume_upload' ||
                  s.action === 'upload' ||
                  /resume|cv|curriculum/i.test(String(s.expected_label || '')),
              )
              .map((s) => ({
                action: s.action,
                status: s.status,
                kind: kind(s.message),
              })),
            selfIdSteps: report.steps
              .filter((s) =>
                /race|ethnic|hispanic|gender|veteran|disabilit/i.test(
                  String(s.expected_label || ''),
                ),
              )
              .map((s) => ({
                action: s.action,
                status: s.status,
                kind: kind(s.message),
              })),
            contactSteps: report.steps
              .filter((s) =>
                /\b(name|phone|mobile|tel|linkedin|url|website|portfolio)\b/i.test(
                  String(s.expected_label || ''),
                ),
              )
              .map((s) => ({
                action: s.action,
                status: s.status,
                kind: kind(s.message),
                alreadyFilled: /already/i.test(String(s.message || '')),
                nameField: /\bname\b/i.test(String(s.expected_label || '')),
                phoneField: /\b(phone|mobile|tel)\b/i.test(String(s.expected_label || '')),
                urlField: /\b(linkedin|url|website|portfolio)\b/i.test(
                  String(s.expected_label || ''),
                ),
              })),
            emptyFieldSuspects: report.steps
              .filter((s) =>
                /password|e-?mail|preferred|consent|text message|sms/i.test(
                  String(s.expected_label || ''),
                ),
              )
              .map((s) => ({
                action: s.action,
                status: s.status,
                kind: kind(s.message),
                alreadyFilled: /already/i.test(String(s.message || '')),
                password: /password/i.test(String(s.expected_label || '')),
                email: /e-?mail/i.test(String(s.expected_label || '')),
                preferred: /preferred/i.test(String(s.expected_label || '')),
                sms: /text message|sms|consent to receive/i.test(
                  String(s.expected_label || ''),
                ),
              })),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion

    emit({
      phase: 'done',
      message: `Done · ${resultLabel} · ${timeLabel} · ${costLabel}`,
      stepTotal,
      durationMs,
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: report.steps,
      resumeUpload: doneResume,
    });
  } catch (err) {
    const { durationMs, usage } = finishMeta();
    const error = err instanceof Error ? err.message : String(err);
    emit({
      phase: 'error',
      message: `Failed · ${formatDuration(durationMs)} · ${formatUsd(usage?.costUsd)}`,
      error,
      durationMs,
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: stepsSnapshot,
    });
  }
}

function countDomNodes(node: DomNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countDomNodes(child), 0);
}
