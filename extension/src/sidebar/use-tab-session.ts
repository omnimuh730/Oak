import { useEffect, useMemo, useState } from 'react';
import {
  IDLE_PIPELINE_PROGRESS,
  mergePipelineProgress,
  type PipelineProgress,
} from '../../../shared/pipeline-types';
import {
  listTabJobs,
  TAB_JOBS_STORAGE_KEY,
  type JobAttachment,
  type TabJobMap,
} from '../tab-job-session';
import {
  listTabPipelines,
  TAB_PIPELINES_STORAGE_KEY,
  type TabPipelineMap,
} from '../tab-pipeline-session';
import { MSG } from '../types';

export function useTabSession(activeTabId: number | null) {
  const [tabJobs, setTabJobs] = useState<TabJobMap>({});
  const [pipelines, setPipelines] = useState<TabPipelineMap>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [jobs, progress] = await Promise.all([
        listTabJobs(),
        listTabPipelines(),
      ]);
      if (!alive) return;
      setTabJobs(jobs);
      setPipelines(progress);
    })();

    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== 'session') return;
      if (changes[TAB_JOBS_STORAGE_KEY]) {
        const next = changes[TAB_JOBS_STORAGE_KEY].newValue;
        setTabJobs(next && typeof next === 'object' ? (next as TabJobMap) : {});
      }
      if (changes[TAB_PIPELINES_STORAGE_KEY]) {
        const next = changes[TAB_PIPELINES_STORAGE_KEY].newValue;
        setPipelines(
          next && typeof next === 'object' ? (next as TabPipelineMap) : {},
        );
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    const onMessage = (message: {
      type?: string;
      tabId?: number;
      progress?: PipelineProgress;
    }) => {
      if (message.type !== MSG.PIPELINE_PROGRESS || !message.progress) return;
      if (typeof message.tabId !== 'number') return;
      const tabId = message.tabId;
      const next = message.progress;
      setPipelines((prev) => {
        const key = String(tabId);
        return {
          ...prev,
          [key]: mergePipelineProgress(prev[key] ?? IDLE_PIPELINE_PROGRESS, next),
        };
      });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const tabKey = activeTabId != null ? String(activeTabId) : null;
  const tabJob = tabKey ? tabJobs[tabKey] ?? null : null;
  const progress = tabKey
    ? pipelines[tabKey] ?? IDLE_PIPELINE_PROGRESS
    : IDLE_PIPELINE_PROGRESS;

  const attachments = useMemo(() => {
    const next: Record<string, JobAttachment> = {};
    for (const [id, job] of Object.entries(tabJobs)) {
      const tabId = Number(id);
      if (!Number.isFinite(tabId)) continue;
      next[job.jobId] = { tabId, active: tabId === activeTabId };
    }
    return next;
  }, [tabJobs, activeTabId]);

  return { tabJobs, tabJob, progress, attachments, setPipelines };
}
