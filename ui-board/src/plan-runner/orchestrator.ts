import type { Socket } from 'socket.io-client';
import { collectForbiddenIndexes, targetsForbiddenIndex } from './forbidden';
import type {
  ActionPlan,
  PauseDecision,
  PauseRequest,
  PlanAction,
  PlanStepActionType,
  PlanStepPayload,
  PlanStepResult,
  RuntimeAttachedFile,
  RunReport,
  RunStepRecord,
} from './types';

export interface OrchestratorHooks {
  onSteps: (steps: RunStepRecord[]) => void;
  onPause: (request: PauseRequest) => Promise<PauseDecision>;
}

export interface RunPlanOptions {
  plan: ActionPlan;
  socket: Socket;
  tabId: number;
  url: string;
  extensionId?: string;
  frameId?: number | null;
  runtimeFile: RuntimeAttachedFile | null;
  hooks: OrchestratorHooks;
}

function isExecutableStep(action: PlanAction['action']): boolean {
  return (
    action === 'fill' ||
    action === 'upload' ||
    action === 'select_radio' ||
    action === 'wait' ||
    action === 'validate'
  );
}

function toStepPayload(
  action: PlanAction,
  runtimeFile: RuntimeAttachedFile | null,
): PlanStepPayload {
  const needsFile = action.action === 'upload';
  return {
    action: action.action as PlanStepActionType,
    element_index: action.element_index,
    element_indexes: action.element_indexes,
    expected_label: action.expected_label,
    expected_role: action.expected_role,
    value: action.value,
    file: needsFile ? runtimeFile : null,
    ms: action.ms,
  };
}

function emitPlanStep(
  socket: Socket,
  args: {
    tabId: number;
    url: string;
    extensionId?: string;
    frameId?: number | null;
    step: PlanStepPayload;
  },
): Promise<PlanStepResult> {
  return new Promise((resolve, reject) => {
    // Keep this under the extension's per-frame timeout so UI fails visibly.
    socket.timeout(45000).emit(
      'dom:plan-step',
      {
        tabId: args.tabId,
        url: args.url,
        extensionId: args.extensionId,
        frameId: args.frameId ?? undefined,
        step: args.step,
      },
      (err: Error | null, res: PlanStepResult) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res ?? { ok: false, error: 'No response from extension' });
      },
    );
  });
}

function summarize(steps: RunStepRecord[]): RunReport['summary'] {
  return {
    ok: steps.filter((s) => s.status === 'ok').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    blocked: steps.filter((s) => s.status === 'blocked').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    paused: steps.filter((s) => s.status === 'paused').length,
  };
}

export async function runActionPlan(options: RunPlanOptions): Promise<RunReport> {
  const { plan, socket, tabId, url, extensionId, frameId, runtimeFile, hooks } = options;
  const forbidden = collectForbiddenIndexes(plan);
  const stopBeforeSubmit = plan.validation?.stop_before_submit !== false;

  const steps: RunStepRecord[] = (plan.actions ?? []).map((action, index) => ({
    index,
    action: action.action,
    element_index: action.element_index,
    expected_label: action.expected_label,
    status: 'pending',
  }));
  hooks.onSteps([...steps]);

  // #region agent log
  fetch('http://127.0.0.1:7567/ingest/aca92173-28e8-4fd1-a862-c844087a3138',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'69bbda'},body:JSON.stringify({sessionId:'69bbda',location:'orchestrator.ts:planStart',message:'plan actions summary',data:{actions:(plan.actions??[]).map((a,i)=>({i,action:a.action,element_index:a.element_index,expected_role:a.expected_role,expected_label:(a.expected_label||'').slice(0,80),value:a.value,reason:(a.reason||'').slice(0,80)}))},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  let aborted = false;

  const publish = () => hooks.onSteps([...steps]);

  for (let i = 0; i < (plan.actions ?? []).length; i++) {
    if (aborted) {
      steps[i].status = 'aborted';
      publish();
      continue;
    }

    const action = plan.actions[i];
    steps[i].status = 'running';
    publish();

    // Marker-only forbidden entries
    if (action.action === 'forbidden') {
      steps[i].status = 'blocked';
      steps[i].message = action.reason || 'Forbidden action marker';
      publish();
      continue;
    }

    if (stopBeforeSubmit && targetsForbiddenIndex(action, forbidden) && action.action !== 'pause_for_review') {
      steps[i].status = 'blocked';
      steps[i].message = 'Blocked: targets a forbidden element index';
      publish();
      continue;
    }

    if (action.action === 'pause_for_review') {
      steps[i].status = 'paused';
      publish();

      // If the planner already chose an option value, autofill the dropdown on Continue.
      const canAutofillPause =
        action.element_index != null &&
        typeof action.value === 'string' &&
        action.value.trim().length > 0;

      const decision = await hooks.onPause({
        index: i,
        action: action.action,
        element_index: action.element_index,
        expected_label: action.expected_label,
        reason: action.reason || 'Paused for human review',
        kind: 'planned',
      });

      if (decision === 'abort') {
        steps[i].status = 'aborted';
        steps[i].message = 'Aborted by user';
        aborted = true;
        publish();
        break;
      }
      if (decision === 'skip') {
        steps[i].status = 'skipped';
        steps[i].message = 'Skipped by user';
        publish();
        continue;
      }

      if (canAutofillPause) {
        try {
          const result = await emitPlanStep(socket, {
            tabId,
            url,
            extensionId,
            frameId,
            step: {
              action: 'select_radio',
              element_index: action.element_index,
              element_indexes: null,
              expected_label: action.expected_label,
              expected_role: action.expected_role,
              value: action.value,
              file: null,
              ms: null,
            },
          });
          // #region agent log
          fetch('http://127.0.0.1:7567/ingest/aca92173-28e8-4fd1-a862-c844087a3138',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'69bbda'},body:JSON.stringify({sessionId:'69bbda',location:'orchestrator.ts:pauseAutofill',message:'pause continue autofill',data:{index:i,element_index:action.element_index,value:action.value,ok:result.ok,error:result.error??null,valueAfter:result.details?.valueAfter??null},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          if (result.ok) {
            steps[i].status = 'ok';
            steps[i].message = result.details?.valueAfter
              ? `value=${result.details.valueAfter}`
              : 'Reviewed — autofilled';
            publish();
            continue;
          }
          steps[i].status = 'failed';
          steps[i].message = result.error || 'Pause autofill failed';
          publish();
          continue;
        } catch (err) {
          steps[i].status = 'failed';
          steps[i].message = err instanceof Error ? err.message : String(err);
          publish();
          continue;
        }
      }

      // Continue = acknowledge pause and proceed without acting
      steps[i].status = 'ok';
      steps[i].message = 'Reviewed — continued';
      publish();
      continue;
    }

    if (!isExecutableStep(action.action)) {
      steps[i].status = 'failed';
      steps[i].message = `Unsupported action: ${action.action}`;
      publish();
      continue;
    }

    if (action.action === 'upload' && !runtimeFile) {
      const decision = await hooks.onPause({
        index: i,
        action: action.action,
        element_index: action.element_index,
        expected_label: action.expected_label,
        reason: 'Upload requires FILE_PATH runtime file, but none was loaded',
        kind: 'error',
      });
      if (decision === 'abort') {
        steps[i].status = 'aborted';
        aborted = true;
        publish();
        break;
      }
      if (decision === 'skip') {
        steps[i].status = 'skipped';
        steps[i].message = 'Skipped missing upload file';
        publish();
        continue;
      }
      // continue retries — still no file, so fail unless they fixed env and we refetch? Plan says Continue retries step.
      // Without refetch hook, treat continue as retry once more then fail into pause loop.
    }

    // Execute with retry-on-continue loop for errors
    let done = false;
    while (!done && !aborted) {
      try {
        if (action.action === 'upload' && !runtimeFile) {
          throw new Error('Upload requires FILE_PATH runtime file');
        }

        const result = await emitPlanStep(socket, {
          tabId,
          url,
          extensionId,
          frameId,
          step: toStepPayload(action, runtimeFile),
        });

        // #region agent log
        if (action.action === 'upload' || action.action === 'validate' || action.action === 'select_radio' || action.action === 'fill') {
          fetch('http://127.0.0.1:7567/ingest/aca92173-28e8-4fd1-a862-c844087a3138',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'69bbda'},body:JSON.stringify({sessionId:'69bbda',location:'orchestrator.ts:stepResult',message:'step result',data:{index:i,action:action.action,element_index:action.element_index,element_indexes:action.element_indexes,ok:result.ok,error:result.error??null,valueAfter:result.details?.valueAfter??null},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
        }
        // #endregion

        if (result.ok) {
          steps[i].status = 'ok';
          steps[i].message = result.details?.valueAfter
            ? `value=${result.details.valueAfter}`
            : undefined;
          publish();
          done = true;
          break;
        }

        steps[i].status = 'paused';
        steps[i].message = result.error || 'Step failed';
        publish();

        const decision = await hooks.onPause({
          index: i,
          action: action.action,
          element_index: action.element_index,
          expected_label: action.expected_label,
          reason: result.error || 'Step failed verification or action',
          kind: 'error',
        });

        if (decision === 'abort') {
          steps[i].status = 'aborted';
          steps[i].message = result.error || 'Aborted';
          aborted = true;
          publish();
          done = true;
        } else if (decision === 'skip') {
          steps[i].status = 'skipped';
          steps[i].message = result.error || 'Skipped after failure';
          publish();
          done = true;
        } else {
          steps[i].status = 'running';
          steps[i].message = 'Retrying...';
          publish();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps[i].status = 'paused';
        steps[i].message = message;
        publish();

        const decision = await hooks.onPause({
          index: i,
          action: action.action,
          element_index: action.element_index,
          expected_label: action.expected_label,
          reason: message,
          kind: 'error',
        });

        if (decision === 'abort') {
          steps[i].status = 'aborted';
          steps[i].message = message;
          aborted = true;
          publish();
          done = true;
        } else if (decision === 'skip') {
          steps[i].status = 'skipped';
          steps[i].message = message;
          publish();
          done = true;
        } else {
          steps[i].status = 'running';
          steps[i].message = 'Retrying...';
          publish();
        }
      }
    }
  }

  if (aborted) {
    for (const step of steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'aborted';
      }
    }
    publish();
  }

  const summary = summarize(steps);
  return {
    ok: !aborted && summary.failed === 0,
    aborted,
    steps,
    summary,
  };
}
