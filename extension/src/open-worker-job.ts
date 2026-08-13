import {
  bindTabJob,
  unbindJobFromAllTabs,
  type OakTabJobBinding,
} from './tab-job-session';

export type OpenWorkerJobResult = {
  tabId: number;
  reused: boolean;
};

async function windowIdForTab(tabId: number | null): Promise<number | undefined> {
  if (tabId == null) return undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.windowId;
  } catch {
    return undefined;
  }
}

/**
 * Open the job apply URL in a new tab and bind this job (and its recommended resume)
 * to that new tab id. Never navigates the currently focused tab.
 */
export async function openWorkerJobInTab(args: {
  job: OakTabJobBinding;
  preferredTabId: number | null;
}): Promise<OpenWorkerJobResult> {
  const { job, preferredTabId } = args;

  const created = await chrome.tabs.create({
    url: job.applyUrl,
    active: true,
    windowId: await windowIdForTab(preferredTabId),
  });
  if (!created.id) {
    throw new Error('Failed to open a tab for this job');
  }

  await unbindJobFromAllTabs(job.jobId);
  await bindTabJob(created.id, job);
  return { tabId: created.id, reused: false };
}
