import {
  formatMetaTreePreview,
  formatPureTreePreview,
  splitDomTree,
} from '../../../shared/tree-export';
import { runActionPlan } from '../../../shared/plan-runner/orchestrator';
import type { ActionPlan, PauseRequest, PlanStepPayload } from '../../../shared/plan-runner/types';
import type { PipelineProgress } from '../../../shared/pipeline-types';
import { sendPlanStepToTab, sendTabMessage } from '../tab-messaging';
import { DEFAULT_AI_SERVER, MSG, type DomNode, type DomTreePayload } from '../types';
import { fetchRuntimeFile, requestAiAnalyze } from './ai-client';

export type PipelineEmit = (progress: PipelineProgress) => void;

export interface RunPipelineArgs {
  tabId: number;
  preferredFrameId?: number | null;
  aiServerUrl?: string;
  /** Emit DOM tree to backend for UI board (optional socket emit callback). */
  emitDomTree?: (payload: DomTreePayload) => void;
  /** Broadcast progress to page FAB + backend. */
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
    return sendTabMessage<DomTreePayload & { error?: string; skipped?: boolean }>(
      tabId,
      { type: MSG.FETCH_DOM },
      frameId,
    );
  };

  if (preferredFrameId != null) {
    const preferred = await attempt(preferredFrameId);
    if (preferred?.tree && !preferred.error) {
      return { ...preferred, tabId, frameId: preferredFrameId };
    }
  }

  const main = await attempt(0);
  if (main?.tree && !main.error) {
    return { ...main, tabId, frameId: 0 };
  }

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    for (const frame of frames ?? []) {
      const res = await attempt(frame.frameId);
      if (!res?.tree || res.error) continue;
      return { ...res, tabId, frameId: frame.frameId };
    }
  } catch {
    // restricted pages
  }

  throw new Error(
    main?.error ||
      'Could not fetch DOM from any frame. Reload the extension and refresh the page.',
  );
}

export async function runFabPipeline(args: RunPipelineArgs): Promise<void> {
  const {
    tabId,
    preferredFrameId = null,
    aiServerUrl = DEFAULT_AI_SERVER,
    emitDomTree,
    onProgress,
  } = args;

  onProgress({ phase: 'fetching', message: 'Fetching DOM…' });

  const treePayload = await fetchDomFromTab(tabId, preferredFrameId);
  emitDomTree?.(treePayload);

  const nodeCount = countDomNodes(treePayload.tree);
  onProgress({
    phase: 'analyzing',
    message: `Analyzing ${nodeCount} nodes…`,
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

  const plan = analyze.plan as ActionPlan;
  const stepTotal = plan.actions?.length ?? 0;

  onProgress({
    phase: 'running',
    message: stepTotal ? `Running 0/${stepTotal}…` : 'Running…',
    stepIndex: 0,
    stepTotal,
  });

  const runtimeFile = await fetchRuntimeFile(aiServerUrl);
  const frameId = treePayload.frameId ?? preferredFrameId ?? null;

  const report = await runActionPlan({
    plan,
    runtimeFile,
    executeStep: async (step: PlanStepPayload) => {
      const res = await sendPlanStepToTab(tabId, step, frameId);
      const details = res.details ?? {};
      return {
        ok: Boolean(res.ok),
        verified: res.verified,
        acted: res.acted,
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
        onProgress({
          phase: 'running',
          message: `Running ${Math.min(idx, stepTotal)}/${stepTotal}…`,
          stepIndex: current?.index,
          stepTotal,
          stepLabel: current
            ? shortLabel(current.expected_label, current.action)
            : undefined,
        });
      },
      onPause: async (request) => {
        onProgress({
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

  if (report.aborted) {
    onProgress({
      phase: 'error',
      message: 'Aborted',
      error: 'Plan run aborted',
      stepTotal,
    });
    return;
  }

  const { summary } = report;
  onProgress({
    phase: 'done',
    message: report.ok
      ? `Done · ${summary.ok} ok`
      : `Done · ${summary.ok} ok, ${summary.skipped} skipped`,
    stepTotal,
  });
}

function countDomNodes(node: DomNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countDomNodes(child), 0);
}
