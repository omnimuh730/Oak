import { formatDuration, formatUsd } from '../../../shared/ai-usage';
import { runActionPlan } from '../../../shared/plan-runner/orchestrator';
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
import { fetchRecommendedResume, fetchRuntimeFile, requestAiAnalyze } from './ai-client';
import {
  addPipelineUsage,
  beginPipelineUsageTracking,
  endPipelineUsageTracking,
} from './usage-tracker';

export type PipelineEmit = (progress: PipelineProgress) => void;

export interface RunPipelineArgs {
  tabId: number;
  preferredFrameId?: number | null;
  aiServerUrl?: string;
  /** Emit DOM tree to backend for UI board (optional socket emit callback). */
  emitDomTree?: (payload: DomTreePayload) => void;
  /** Broadcast progress to the sidebar overlay + backend. */
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

  return candidates[0];
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

    const treePayload = await fetchDomFromTab(tabId, preferredFrameId);
    emitDomTree?.(treePayload);
    treeSnapshot = {
      url: treePayload.url,
      title: treePayload.title,
      tree: treePayload.tree,
      fetchedAt: treePayload.fetchedAt,
    };

    const nodeCount = countDomNodes(treePayload.tree);
    emit({
      phase: 'analyzing',
      message: `Analyzing ${nodeCount} nodes…`,
      tree: treeSnapshot,
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
        },
      },
      aiServerUrl,
    );
    addPipelineUsage(tabId, analyze.usage);

    const plan = analyze.plan as ActionPlan;
    planSnapshot = plan;
    const stepTotal = plan.actions?.length ?? 0;

    emit({
      phase: 'running',
      message: stepTotal ? `Running 0/${stepTotal}…` : 'Running…',
      stepIndex: 0,
      stepTotal,
      plan,
    });

    const runtimeFile = await fetchRuntimeFile(aiServerUrl);
    const tabJob = await getTabJob(tabId);
    const recommendedResume = tabJob?.jobId
      ? await fetchRecommendedResume(tabJob.jobId, aiServerUrl)
      : null;
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
          });
          return autoPauseDecision(request);
        },
      },
    });

    const { durationMs, usage } = finishMeta();
    const timeLabel = formatDuration(durationMs);
    const costLabel = formatUsd(usage?.costUsd);

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
      });
      return;
    }

    const { summary } = report;
    const resultLabel = report.ok
      ? `${summary.ok} ok`
      : `${summary.ok} ok, ${summary.skipped} skipped`;

    emit({
      phase: 'done',
      message: `Done · ${resultLabel} · ${timeLabel} · ${costLabel}`,
      stepTotal,
      durationMs,
      usage,
      tree: treeSnapshot,
      plan: planSnapshot,
      steps: report.steps,
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
