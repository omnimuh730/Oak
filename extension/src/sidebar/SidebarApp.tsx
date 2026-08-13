import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDuration, formatUsd } from '../../../shared/ai-usage';
import type { ActionPlan, RunStepRecord } from '../../../shared/plan-runner/types';
import type { PipelineProgress } from '../../../shared/pipeline-types';
import {
  formatMetaTreePreview,
  formatPureTreePreview,
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
import { InspectPanel } from './InspectPanel';
import { ResumeUploadNote } from './ResumeUploadNote';
import { WorkerPoolList, type OakWorkerJob } from './WorkerPoolList';
import './SidebarApp.css';

function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response as T);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function requestStartPipeline() {
  window.parent.postMessage({ type: MSG.START_PIPELINE }, '*');
}

export default function SidebarApp() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_ATHENS_API_URL);
  const [session, setSession] = useState<OakStoredSession | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [lastFetch, setLastFetch] = useState<DomTreePayload | null>(null);
  const [progress, setProgress] = useState<PipelineProgress>({
    phase: 'idle',
    message: 'Idle',
  });
  const [inspect, setInspect] = useState<{ title: string; content: string } | null>(null);
  const [workerJobs, setWorkerJobs] = useState<OakWorkerJob[]>([]);
  const [workerJobsLoading, setWorkerJobsLoading] = useState(false);
  const [workerJobsError, setWorkerJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [openingJob, setOpeningJob] = useState(false);

  const pipelineBusy =
    progress.phase === 'fetching' ||
    progress.phase === 'analyzing' ||
    progress.phase === 'running';

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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== MSG.PIPELINE_PROGRESS || !event.data.progress) return;
      const next = event.data.progress as PipelineProgress;
      const starting = next.phase === 'fetching';
      setProgress((prev) => ({
        ...prev,
        ...next,
        tree: starting ? next.tree : next.tree ?? prev.tree,
        plan: starting ? next.plan : next.plan ?? prev.plan,
        steps: starting ? next.steps ?? [] : next.steps ?? prev.steps,
        resumeUpload: starting ? next.resumeUpload : next.resumeUpload ?? prev.resumeUpload,
      }));
      if (next.tree) {
        setLastFetch({
          url: next.tree.url,
          title: next.tree.title,
          tree: next.tree.tree as unknown as DomNode,
          fetchedAt: next.tree.fetchedAt,
        });
      }
      if (next.phase === 'idle') {
        setStatus(next.message || 'Ready');
        return;
      }
      const parts = [
        next.message,
        next.stepLabel ? `Step: ${next.stepLabel}` : null,
        next.durationMs != null ? `Time: ${formatDuration(next.durationMs)}` : null,
        next.usage
          ? `AI: ${formatUsd(next.usage.costUsd)} · ${next.usage.totalTokens || 0} tok`
          : null,
        next.error ? `Error: ${next.error}` : null,
      ].filter(Boolean);
      setStatus(parts.join(' · '));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleSignIn = async () => {
    setAuthBusy(true);
    setStatus('Signing in…');
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
      setStatus(`Signed in as ${res.session.displayName}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
      setStatus('Signed out');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setWorkerJobs([]);
      setWorkerJobsError(null);
      setSelectedJobId(null);
      return;
    }
    void (async () => {
      await fetchWorkerJobs();
      try {
        const res = await sendMessage<{
          ok?: boolean;
          job?: { jobId?: string } | null;
        }>({ type: MSG.GET_TAB_JOB });
        if (res?.job?.jobId) setSelectedJobId(res.job.jobId);
      } catch {
        /* ignore */
      }
    })();
  }, [session, fetchWorkerJobs]);

  const openWorkerJob = useCallback(async (job: OakWorkerJob) => {
    setOpeningJob(true);
    setStatus(`Opening ${job.title}…`);
    try {
      const res = await sendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.OPEN_WORKER_JOB,
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
      setSelectedJobId(job.id);
      setStatus(`Opened ${job.company} — ${job.title}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpeningJob(false);
    }
  }, []);

  const fetchDom = useCallback(async () => {
    setFetching(true);
    setStatus('Fetching DOM…');

    try {
      const response = await sendMessage<DomTreePayload & { error?: string }>({
        type: MSG.FETCH_AND_EMIT_DOM,
      });

      if (response?.error) {
        setStatus(`Error: ${response.error}`);
        return;
      }

      if (!isValidTree(response?.tree)) {
        setStatus('Error: invalid DOM tree received');
        return;
      }

      const payload: DomTreePayload = response;
      setLastFetch(payload);
      setStatus(`Sent ${countNodes(payload.tree)} nodes to UI board`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFetching(false);
    }
  }, []);

  const treeNode = lastFetch?.tree as unknown as DomTreeNode | undefined;
  const splitTrees = useMemo(() => {
    if (!treeNode) return null;
    return splitDomTree(treeNode);
  }, [treeNode]);

  const plan: ActionPlan | undefined = progress.plan;
  const steps: RunStepRecord[] = progress.steps ?? [];
  const nodeCount = lastFetch ? countNodes(lastFetch.tree) : 0;

  const stepSummary = {
    ok: steps.filter((s) => s.status === 'ok').length,
    skipped: steps.filter((s) => s.status === 'skipped').length,
    blocked: steps.filter((s) => s.status === 'blocked').length,
    failed: steps.filter((s) => s.status === 'failed' || s.status === 'aborted').length,
  };

  const openPureTree = () => {
    if (!splitTrees) return;
    setInspect({
      title: 'Pure Tree',
      content: formatPureTreePreview(splitTrees.pure),
    });
  };

  const openMetaTree = () => {
    if (!splitTrees) return;
    setInspect({
      title: 'Meta Tree',
      content: formatMetaTreePreview(splitTrees.meta, splitTrees.pure),
    });
  };

  const openAiAnalyze = () => {
    if (!plan) return;
    setInspect({
      title: 'AI Analyze',
      content: JSON.stringify(plan, null, 2),
    });
  };

  return (
    <div className="sidebar-app">
      <section className="welcome">
        <h2>Oak</h2>
        <p className="hint">
          Sign in, pick a Worker pool job like Athens Lens, then Fill the current page
          (Fetch → Analyze → Fill). Resume file inputs use the Library resume recommended
          in Job Search.
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

      {session ? (
        <WorkerPoolList
          jobs={workerJobs}
          loading={workerJobsLoading}
          error={workerJobsError}
          selectedJobId={selectedJobId}
          opening={openingJob}
          onRefresh={() => void fetchWorkerJobs()}
          onOpen={(job) => void openWorkerJob(job)}
        />
      ) : null}

      <section className="tools">
        <h3>Fill</h3>
        <button
          type="button"
          className={`fill-card ${progress.phase}`}
          onClick={() => requestStartPipeline()}
          disabled={pipelineBusy || !session}
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
          boundStack={
            workerJobs.find((job) => job.id === selectedJobId)?.recommendedResumeStack ??
            null
          }
          hasBoundJob={Boolean(selectedJobId)}
        />
        <div className="tool-grid" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="tool-card"
            onClick={() => void fetchDom()}
            disabled={fetching || pipelineBusy || !connected || !session}
          >
            <span className="tool-icon">⬡</span>
            <span className="tool-label">{fetching ? 'Fetching…' : 'Fetch DOM'}</span>
          </button>
        </div>
      </section>

      {lastFetch && isValidTree(lastFetch.tree) && (
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
              <button type="button" disabled={!splitTrees} onClick={openPureTree}>
                Pure Tree
              </button>
              <button type="button" disabled={!splitTrees} onClick={openMetaTree}>
                Meta Tree
              </button>
              <button type="button" disabled={!plan} onClick={openAiAnalyze}>
                {plan ? 'AI Analyze' : 'AI Analyze (pending)'}
              </button>
            </div>
          </div>
        </section>
      )}

      {steps.length > 0 && (
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
          <ul className="plan-run-steps">
            {steps.map((step) => (
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
        </section>
      )}

      {inspect && (
        <InspectPanel
          title={inspect.title}
          content={inspect.content}
          onClose={() => setInspect(null)}
        />
      )}

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
