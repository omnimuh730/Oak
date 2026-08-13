import { useState } from 'react';
import type { JobAttachment } from '../tab-job-session';

export type OakWorkerJob = {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  location: string;
  workMode?: string;
  applyUrl: string;
  workerPoolAt: string | null;
  recommendedResumeStack: string | null;
  recommendedResumeId: string | null;
  recommendedResumeReason: string | null;
  recommendWarning: string | null;
  recommendedAt: string | null;
};

type WorkerPoolListProps = {
  jobs: OakWorkerJob[];
  loading: boolean;
  error: string | null;
  selectedJobId: string | null;
  attachments: Record<string, JobAttachment>;
  opening: boolean;
  markingJobId: string | null;
  onRefresh: () => void;
  onOpen: (job: OakWorkerJob) => void;
  onMarkApplied: (job: OakWorkerJob) => void;
};

function CompanyMark({ company, logoUrl }: { company: string; logoUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const initial = company.trim().charAt(0).toUpperCase() || '?';
  const showImg = Boolean(logoUrl) && failedUrl !== logoUrl;

  return (
    <span className="job-logo" aria-hidden="true">
      {showImg ? (
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(logoUrl || '')}
        />
      ) : (
        <span className="job-logo-fallback">{initial}</span>
      )}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.7 13.3 4.4 10l-1.4 1.4 4.7 4.7 10-10L16.3 4.7z"
      />
    </svg>
  );
}

export function WorkerPoolList({
  jobs,
  loading,
  error,
  selectedJobId,
  attachments,
  opening,
  markingJobId,
  onRefresh,
  onOpen,
  onMarkApplied,
}: WorkerPoolListProps) {
  return (
    <section className="worker-pool">
      <div className="worker-pool-head">
        <div>
          <h3>Jobs</h3>
          <p className="worker-pool-count">
            {loading ? 'Loading…' : `${jobs.length} jobs`}
          </p>
        </div>
        <button
          type="button"
          className="tool-card worker-pool-refresh"
          onClick={onRefresh}
          disabled={loading || opening || Boolean(markingJobId)}
        >
          Refresh
        </button>
      </div>
      {error ? <p className="worker-pool-error">{error}</p> : null}
      {!loading && !error && jobs.length === 0 ? (
        <p className="hint">
          No jobs in Worker pool. In Job Search, move roles to Worker pool.
        </p>
      ) : null}
      <nav className="worker-pool-list" aria-label="Worker pool jobs">
        {jobs.map((job) => {
          const selected = selectedJobId === job.id;
          const marking = markingJobId === job.id;
          const attached = attachments[job.id];
          const openTitle = attached?.active
            ? 'Already attached to this tab'
            : attached
              ? 'Switch to the attached tab'
              : job.applyUrl
                ? 'Open apply page and attach this tab'
                : 'No apply URL';
          return (
            <div
              key={job.id}
              className={`worker-pool-item${selected ? ' selected' : ''}${attached && !selected ? ' attached' : ''}${marking ? ' marking' : ''}`}
            >
              <button
                type="button"
                className="worker-pool-open"
                disabled={opening || marking || !job.applyUrl}
                aria-current={selected ? 'page' : undefined}
                title={openTitle}
                onClick={() => onOpen(job)}
              >
                <CompanyMark company={job.company} logoUrl={job.companyLogoUrl} />
                <span className="job-list-copy">
                  <strong className="worker-pool-title">{job.title}</strong>
                  <span className="worker-pool-meta">{job.company}</span>
                  <span className="worker-pool-location">
                    {job.location}
                    {job.workMode ? ` · ${job.workMode}` : ''}
                  </span>
                  {job.recommendedResumeStack || job.recommendedResumeId ? (
                    <span className="worker-pool-resume">
                      Resume: {job.recommendedResumeStack || 'assigned'}
                    </span>
                  ) : (
                    <span className="worker-pool-resume muted">No resume assigned</span>
                  )}
                  {attached?.active ? (
                    <span className="worker-pool-tab">Attached to this tab</span>
                  ) : attached ? (
                    <span className="worker-pool-tab">Attached to another tab</span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                className="worker-pool-applied"
                disabled={opening || marking}
                title="Mark as applied"
                aria-label={`Mark ${job.title} as applied`}
                onClick={() => onMarkApplied(job)}
              >
                <CheckIcon />
              </button>
            </div>
          );
        })}
      </nav>
    </section>
  );
}
