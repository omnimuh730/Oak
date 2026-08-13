import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from '../../../shared/pipeline-types';
import type { ActionPlan, RunStepRecord } from '../../../shared/plan-runner/types';
import {
  collectLines,
  formatMetaTreePreview,
  formatPureTreePreview,
  iterateMetaTreeLines,
  iteratePureTreeLines,
  splitDomTree,
  type DomTreeNode,
} from '../../../shared/tree-export';
import {
  DEFAULT_ATHENS_API_URL,
  getAthensApiUrl,
  getOakSession,
  setAthensApiUrl,
  type OakStoredSession,
} from '../auth/oak-auth';
import { MSG, type DomNode, type DomTreePayload } from '../types';
import { InspectPanel, useInspectWindow } from './InspectPanel';
import { LoadMoreFooter } from './LoadMoreFooter';
import { formatProgressStatus } from './progress-status';
import { ResumeUploadNote } from './ResumeUploadNote';
import { sendMessage } from './runtime';
import { clearTabTree, getTabTree, setTabTree, type TabTreeSummary } from './tab-tree-cache';
import { useActiveTabId } from './use-active-tab';
import { useShownCount } from './use-shown-count';
import { useTabSession } from './use-tab-session';
import { WorkerPoolList, type OakWorkerJob } from './WorkerPoolList';
import './SidebarApp.css';

type InspectKind = 'pure' | 'meta' | 'plan';

type TabUi = {
  lastFetch: TabTreeSummary | null;
  inspect: { title: string; kind: InspectKind } | null;
  fetching: boolean;
};

const EMPTY_TAB_UI: TabUi = {
  lastFetch: null,
  inspect: null,
  fetching: false,
};

const STEP_PAGE = 30;

export default function SidebarApp() {
  const activeTabId = useActiveTabId();
  const { tabJob, progress, attachments, setPipelines } = useTabSession(activeTabId);

  const [apiUrl, setApiUrl] = useState(DEFAULT_ATHENS_API_URL);
  const [session, setSession] = useState<OakStoredSession | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tabUi, setTabUi] = useState<Record<string, TabUi>>({});
  const [workerJobs, setWorkerJobs] = useState<OakWorkerJob[]>([]);
  const [workerJobsLoading, setWorkerJobsLoading] = useState(false);
  const [workerJobsError, setWorkerJobsError] = useState<string | null>(null);
  const [openingJob, setOpeningJob] = useState(false);
  const [markingJobId, setMarkingJobId] = useState<string | null>(null);
  const [jobsListKey, setJobsListKey] = useState(0);

  const tabKey = activeTabId != null ? String(activeTabId) : null;
  const ui = (tabKey && tabUi[tabKey]) || EMPTY_TAB_UI;
  const pipelineBusy =
    progress.phase === 'fetching' ||
    progress.phase === 'analyzing' ||
    progress.phase === 'running';

  const patchTabUi = useCallback((tabId: number, patch: Partial<TabUi>) => {
    setTabUi((prev) => {
      const key = String(tabId);
      return { ...prev, [key]: { ...(prev[key] ?? EMPTY_TAB_UI), ...patch } };
    });
  }, []);

  const setTabProgress = useCallback(
    (tabId: number, next: PipelineProgress) => {
      setPipelines((prev) => {
        const key = String(tabId);
        return {
          ...prev,
          [key]: mergePipelineProgress(prev[key] ?? IDLE_PIPELINE_PROGRESS, next),
        };
      });
    },
    [setPipelines],
  );

  useEffect(() => {
    void (async () => {
      setApiUrl(await getAthensApiUrl());
      setSession(await getOakSession());
    })();
  }, []);

  useEffect(() => {
    void setAthensApiUrl(apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    setNotice(null);
  }, [activeTabId]);

  useEffect(() => {
    const onRemoved = (tabId: number) => {
      clearTabTree(tabId);
      setTabUi((prev) => {
        const key = String(tabId);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }, []);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      try {
        const res = await sendMessage<{ connected?: boolean }>({ type: MSG.SOCKET_STATUS });
        if (alive) setConnected(Boolean(res?.connected));
      } catch {
        if (alive) setConnected(false);
      }
    };

    check();
    const id = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, apiUrl]);

  const cacheTree = useCallback(
    (tabId: number, payload: { url: string; title: string; fetchedAt: string; tree: DomTreeNode }) => {
      const existing = getTabTree(tabId);
      if (existing?.fetchedAt === payload.fetchedAt) {
        patchTabUi(tabId, {
          lastFetch: {
            url: existing.url,
            title: existing.title,
            fetchedAt: existing.fetchedAt,
            nodeCount: existing.nodeCount,
          },
        });
        return;
      }
      const nodeCount = countNodes(payload.tree as unknown as DomNode);
      const summary: TabTreeSummary = {
        url: payload.url,
        title: payload.title,
        fetchedAt: payload.fetchedAt,
        nodeCount,
      };
      setTabTree(tabId, { ...summary, tree: payload.tree });
      patchTabUi(tabId, { lastFetch: summary });
    },
    [patchTabUi],
  );

  useEffect(() => {
    if (activeTabId == null || !progress.tree) return;
    if (!isValidTree(progress.tree.tree)) return;
    cacheTree(activeTabId, {
      url: progress.tree.url,
      title: progress.tree.title,
      fetchedAt: progress.tree.fetchedAt,
      tree: progress.tree.tree,
    });
  }, [activeTabId, progress.tree, cacheTree]);

  const handleSignIn = async () => {
    setAuthBusy(true);
    setNotice('Signing in…');
    try {
      const res = await sendMessage<{
        ok?: boolean;
        error?: string;
        session?: OakStoredSession;
      }>({
        type: MSG.AUTH_SIGNIN,
        name: name.trim(),
        password,
        apiUrl,
      });
      if (!res?.ok || !res.session) {
        throw new Error(res?.error || 'Sign in failed');
      }
      setSession(res.session);
      setPassword('');
      setNotice(`Signed in as ${res.session.displayName}`);
    } catch (err) {
      setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthBusy(true);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.AUTH_SIGNOUT,
      });
      if (!res?.ok) {
        throw new Error(res?.error || 'Sign out failed');
      }
      setSession(null);
      setNotice('Signed out');
    } catch (err) {
      setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const fetchWorkerJobs = useCallback(async () => {
    setWorkerJobsLoading(true);
    setWorkerJobsError(null);
    try {
      const res = await sendMessage<{
        ok?: boolean;
        error?: string;
        jobs?: OakWorkerJob[];
      }>({ type: MSG.LIST_WORKER_JOBS });
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to load Worker pool');
      }
      setWorkerJobs(Array.isArray(res.jobs) ? res.jobs : []);
    } catch (err) {
      setWorkerJobs([]);
      setWorkerJobsError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkerJobsLoading(false);
      setJobsListKey((key) => key + 1);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setWorkerJobs([]);
      setWorkerJobsError(null);
      setJobsListKey((key) => key + 1);
      return;
    }
    void fetchWorkerJobs();
  }, [session, fetchWorkerJobs]);

  const openWorkerJob = useCallback(
    async (job: OakWorkerJob) => {
      setOpeningJob(true);
      setNotice(`Opening ${job.title}…`);
      try {
        const res = await sendMessage<{
          ok?: boolean;
          error?: string;
          tabId?: number;
          reused?: boolean;
        }>({
          type: MSG.OPEN_WORKER_JOB,
          tabId: activeTabId,
          jobId: job.id,
          applyUrl: job.applyUrl,
          resumeId: job.recommendedResumeId,
          resumeStack: job.recommendedResumeStack,
          title: job.title,
          company: job.company,
        });
        if (!res?.ok) {
          throw new Error(res?.error || 'Failed to open job');
        }
        setNotice(`Opened new tab · ${job.company} — ${job.title}`);
      } catch (err) {
        setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setOpeningJob(false);
      }
    },
    [activeTabId],
  );

  const markJobApplied = useCallback(async (job: OakWorkerJob) => {
    setMarkingJobId(job.id);
    setWorkerJobs((prev) => prev.filter((row) => row.id !== job.id));
    setNotice(`Marking applied: ${job.company} — ${job.title}`);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.MARK_JOB_APPLIED,
        jobId: job.id,
      });
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to mark as applied');
      }
      setNotice(`Marked applied: ${job.company} — ${job.title}`);
    } catch (err) {
      setWorkerJobs((prev) => {
        if (prev.some((row) => row.id === job.id)) return prev;
        return [job, ...prev];
      });
      setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMarkingJobId(null);
    }
  }, []);

  const startPipeline = useCallback(async () => {
    const tabId = activeTabId;
    if (pipelineBusy || tabId == null) return;
    setTabProgress(tabId, { phase: 'fetching', message: 'Starting…' });
    setNotice(null);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.START_PIPELINE,
        tabId,
      });
      if (res?.error) {
        const err = String(res.error);
        if (/sign in/i.test(err)) {
          setTabProgress(tabId, {
            phase: 'idle',
            message: 'Sign in to Athens to run Oak',
          });
          return;
        }
        throw new Error(err);
      }
    } catch (err) {
      setTabProgress(tabId, {
        phase: 'error',
        message: 'Failed to start',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeTabId, pipelineBusy, setTabProgress]);

  const fetchDom = useCallback(async () => {
    const tabId = activeTabId;
    if (tabId == null) return;
    patchTabUi(tabId, { fetching: true });
    setNotice('Fetching DOM…');

    try {
      const response = await sendMessage<DomTreePayload & { error?: string }>({
        type: MSG.FETCH_AND_EMIT_DOM,
        tabId,
      });

      if (response?.error) {
        setNotice(`Error: ${response.error}`);
        return;
      }

      if (!isValidTree(response?.tree)) {
        setNotice('Error: invalid DOM tree received');
        return;
      }

      cacheTree(tabId, {
        url: response.url,
        title: response.title,
        fetchedAt: response.fetchedAt,
        tree: response.tree as unknown as DomTreeNode,
      });
      setNotice(`Sent ${getTabTree(tabId)?.nodeCount ?? 0} nodes to UI board`);
    } catch (err) {
      setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      patchTabUi(tabId, { fetching: false });
    }
  }, [activeTabId, patchTabUi, cacheTree]);

  const lastFetch = ui.lastFetch;
  const inspectKind = ui.inspect?.kind ?? null;
  const treeStamp = lastFetch?.fetchedAt;

  const splitTrees = useMemo(() => {
    if (inspectKind !== 'pure' && inspectKind !== 'meta') return null;
    if (activeTabId == null) return null;
    const tree = getTabTree(activeTabId)?.tree;
    if (!tree) return null;
    return splitDomTree(tree);
  }, [inspectKind, activeTabId, treeStamp]);

  const plan: ActionPlan | undefined = progress.plan;
  const steps: RunStepRecord[] = progress.steps ?? [];
  const nodeCount = lastFetch?.nodeCount ?? 0;

  const {
    shownCount: stepShown,
    loadMore: loadMoreSteps,
    ensureCount: ensureStepCount,
  } = useShownCount(STEP_PAGE, plan);
  const visibleSteps = steps.slice(0, stepShown);
  const hasMoreSteps = stepShown < steps.length;
  const stepsListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const runningIdx = steps.findIndex(
      (step) => step.status === 'running' || step.status === 'paused',
    );
    if (runningIdx >= 0) ensureStepCount(runningIdx + 1);
  }, [steps, ensureStepCount]);

  const inspectWindow = useInspectWindow(inspectKind);

  const inspectView = useMemo(() => {
    if (!inspectKind) return null;
    if (inspectKind === 'plan') {
      const all = JSON.stringify(plan ?? {}, null, 2).split('\n');
      return {
        lines: all.slice(0, inspectWindow.shownCount),
        hasMore: inspectWindow.shownCount < all.length,
        copy: () => navigator.clipboard.writeText(all.join('\n')),
      };
    }
    if (!splitTrees) return { lines: [] as string[], hasMore: false, copy: async () => undefined };
    if (inspectKind === 'pure') {
      const collected = collectLines(
        iteratePureTreeLines(splitTrees.pure),
        inspectWindow.shownCount,
      );
      return {
        ...collected,
        copy: () => navigator.clipboard.writeText(formatPureTreePreview(splitTrees.pure)),
      };
    }
    const collected = collectLines(
      iterateMetaTreeLines(splitTrees.meta, splitTrees.pure),
      inspectWindow.shownCount,
    );
    return {
      ...collected,
      copy: () =>
        navigator.clipboard.writeText(
          formatMetaTreePreview(splitTrees.meta, splitTrees.pure),
        ),
    };
  }, [inspectKind, inspectWindow.shownCount, plan, splitTrees]);

  const stepSummary = {
    ok: steps.filter((s) => s.status === 'ok').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    blocked: steps.filter((s) => s.status === 'blocked').length,
    failed: steps.filter((s) => s.status === 'failed' || s.status === 'aborted').length,
  };

  const openInspect = (kind: InspectKind, title: string) => {
    if (activeTabId == null) return;
    patchTabUi(activeTabId, { inspect: { title, kind } });
  };

  const status = notice ?? formatProgressStatus(progress);
  const boundResumeStack =
    tabJob?.resumeStack ??
    workerJobs.find((job) => job.id === tabJob?.jobId)?.recommendedResumeStack ??
    null;
  const hasTree = Boolean(lastFetch);

  return (
    <div className={`sidebar-app${session ? ' signed-in' : ''}`}>
      <div className="sidebar-chrome">
        <section className="welcome">
          <h2>Oak</h2>
          <p className="hint">
            Sign in, pick a Worker pool job like Athens Lens, then Fill the current page
            (Fetch → Analyze → Fill). Resume file inputs use the Library resume recommended
            in Job Search. Each tab keeps its own job, resume, and fill run.
          </p>
        </section>

        <section className="connection">
          <h3>Athens account</h3>
          {session ? (
            <div className="auth-signed-in">
              <p className="auth-user">
                Signed in as <strong>{session.displayName}</strong>
              </p>
              <button
                type="button"
                className="tool-card"
                onClick={() => void handleSignOut()}
                disabled={authBusy || pipelineBusy}
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="auth-form">
              <label className="field">
                <span>Username</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="username"
                  placeholder="Athens username"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Athens password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSignIn();
                  }}
                />
              </label>
              <button
                type="button"
                className="tool-card primary"
                onClick={() => void handleSignIn()}
                disabled={authBusy || !name.trim() || !password}
              >
                {authBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          )}

          <label className="field" style={{ marginTop: 12 }}>
            <span>Athens API URL</span>
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://127.0.0.1:8980"
            />
          </label>
          <div className={`conn-status ${connected ? 'on' : 'off'}`}>
            <span className="dot" />
            {connected
              ? 'Socket connected'
              : session
                ? 'Socket offline'
                : 'Sign in to connect'}
          </div>
        </section>
      </div>

      <section className="tools">
        <h3>Fill</h3>
        {tabJob ? (
          <p className="tab-job-chip">
            This tab: <strong>{tabJob.company}</strong> — {tabJob.title}
          </p>
        ) : (
          <p className="hint">No Worker pool job attached to this tab.</p>
        )}
        <button
          type="button"
          className={`fill-card ${progress.phase}`}
          onClick={() => void startPipeline()}
          disabled={pipelineBusy || !session || activeTabId == null}
        >
          <span className="tool-icon">▶</span>
          <span className="tool-label">
            {pipelineBusy
              ? progress.message
              : progress.phase === 'done'
                ? 'Fill again'
                : 'Fill page'}
          </span>
          <span className="tool-hint">Fetch → Analyze → Fill</span>
        </button>
        <ResumeUploadNote
          progress={progress}
          boundStack={boundResumeStack}
          hasBoundJob={Boolean(tabJob)}
        />
        <div className="tool-grid" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="tool-card"
            onClick={() => void fetchDom()}
            disabled={ui.fetching || pipelineBusy || !connected || !session || activeTabId == null}
          >
            <span className="tool-icon">⬡</span>
            <span className="tool-label">{ui.fetching ? 'Fetching…' : 'Fetch DOM'}</span>
          </button>
        </div>
      </section>

      {session ? (
        <WorkerPoolList
          jobs={workerJobs}
          loading={workerJobsLoading}
          error={workerJobsError}
          selectedJobId={tabJob?.jobId ?? null}
          attachments={attachments}
          opening={openingJob}
          markingJobId={markingJobId}
          listKey={jobsListKey}
          onRefresh={() => void fetchWorkerJobs()}
          onOpen={(job) => void openWorkerJob(job)}
          onMarkApplied={(job) => void markJobApplied(job)}
        />
      ) : null}

      <div className="sidebar-after">
        {lastFetch ? (
          <section className="preview">
            <h3>Analyzed tree</h3>
            <div className="preview-card">
              <div className="preview-title">{String(lastFetch.title ?? 'Untitled')}</div>
              <div className="preview-url">{String(lastFetch.url ?? '')}</div>
              <div className="preview-meta">
                <span>{nodeCount} nodes</span>
                <span>{new Date(lastFetch.fetchedAt).toLocaleTimeString()}</span>
              </div>
              <div className="tree-actions">
                <button type="button" disabled={!hasTree} onClick={() => openInspect('pure', 'Pure Tree')}>
                  Pure Tree
                </button>
                <button type="button" disabled={!hasTree} onClick={() => openInspect('meta', 'Meta Tree')}>
                  Meta Tree
                </button>
                <button
                  type="button"
                  disabled={!plan}
                  onClick={() => openInspect('plan', 'AI Analyze')}
                >
                  {plan ? 'AI Analyze' : 'AI Analyze (pending)'}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {steps.length > 0 ? (
          <section className="plan-run">
            <h3>Plan run</h3>
            {plan?.goal && <p className="plan-goal">{plan.goal}</p>}
            <div className="plan-run-summary">
              <span>ok {stepSummary.ok}</span>
              <span>skipped {stepSummary.skipped}</span>
              <span>blocked {stepSummary.blocked}</span>
              <span>failed {stepSummary.failed}</span>
              {pipelineBusy && <span className="plan-run-live">running…</span>}
            </div>
            <div ref={stepsListRef} className="plan-run-scroll">
              <ul className="plan-run-steps">
                {visibleSteps.map((step) => (
                  <li key={step.index} className={`plan-step status-${step.status}`}>
                    <span className="plan-step-idx">{step.index + 1}</span>
                    <span className="plan-step-action">{step.action}</span>
                    <span className="plan-step-status">{stepStatusLabel(step)}</span>
                    <span className="plan-step-target">
                      {step.element_index != null ? `[${step.element_index}]` : '—'}
                      {step.expected_label ? ` ${step.expected_label}` : ''}
                    </span>
                    {step.message && <span className="plan-step-msg">{step.message}</span>}
                  </li>
                ))}
              </ul>
              <LoadMoreFooter
                hasMore={hasMoreSteps}
                onLoadMore={loadMoreSteps}
                rootRef={stepsListRef}
                label={`Load more (${visibleSteps.length} of ${steps.length})`}
              />
            </div>
          </section>
        ) : null}
      </div>

      {ui.inspect && inspectView ? (
        <InspectPanel
          title={ui.inspect.title}
          lines={inspectView.lines}
          hasMore={inspectView.hasMore}
          onLoadMore={inspectWindow.loadMore}
          onCopy={inspectView.copy}
          onClose={() => {
            if (activeTabId != null) patchTabUi(activeTabId, { inspect: null });
          }}
        />
      ) : null}

      <footer className={`status-bar phase-${progress.phase}`}>
        <span>{status}</span>
      </footer>
    </div>
  );
}

function stepStatusLabel(step: RunStepRecord): string {
  if (step.status === 'ok') return 'verified';
  return step.status;
}

function isValidTree(tree: unknown): tree is DomNode {
  return Boolean(tree && typeof tree === 'object' && 'tag' in (tree as object));
}

function countNodes(node: DomNode | undefined): number {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}
