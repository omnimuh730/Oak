import { useState } from 'react';

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
  opening: boolean;
  onRefresh: () => void;
  onOpen: (job: OakWorkerJob) => void;
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

export function WorkerPoolList({
  jobs,
  loading,
  error,
  selectedJobId,
  opening,
  onRefresh,
  onOpen,
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
          disabled={loading || opening}
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
          return (
            <button
              key={job.id}
              type="button"
              className={`worker-pool-item${selected ? ' selected' : ''}`}
              disabled={opening || !job.applyUrl}
              aria-current={selected ? 'page' : undefined}
              title={job.applyUrl ? 'Open apply page in this tab' : 'No apply URL'}
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
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}
