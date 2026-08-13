import {
  bindTabJob,
  findTabIdForJob,
  getTabJob,
  unbindJobFromAllTabs,
  unbindTabJob,
  type OakTabJobBinding,
} from './tab-job-session';

export type OpenWorkerJobResult = {
  tabId: number;
  reused: boolean;
};

async function tabExists(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function windowIdForTab(tabId: number | null): Promise<number | undefined> {
  if (tabId == null) return undefined;
  const tab = await tabExists(tabId);
  return tab?.windowId;
}

/**
 * Attach a Worker pool job to a tab and open its apply URL.
 * Reuses the existing attached tab when this job is already bound.
 * Opens a new tab when the preferred tab already has a different job.
 */
export async function openWorkerJobInTab(args: {
  job: OakTabJobBinding;
  preferredTabId: number | null;
}): Promise<OpenWorkerJobResult> {
  const { job, preferredTabId } = args;

  const existingTabId = await findTabIdForJob(job.jobId);
  if (existingTabId != null) {
    const existing = await tabExists(existingTabId);
    if (existing?.id) {
      await unbindJobFromAllTabs(job.jobId);
      await bindTabJob(existing.id, job);
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return { tabId: existing.id, reused: true };
    }
    await unbindTabJob(existingTabId);
  }

  const preferred = preferredTabId != null ? await tabExists(preferredTabId) : null;
  const preferredBinding =
    preferred?.id != null ? await getTabJob(preferred.id) : null;
  const canReusePreferred =
    preferred?.id != null &&
    (!preferredBinding || preferredBinding.jobId === job.jobId);

  if (canReusePreferred && preferred?.id != null) {
    await unbindJobFromAllTabs(job.jobId);
    await bindTabJob(preferred.id, job);
    await chrome.tabs.update(preferred.id, { url: job.applyUrl, active: true });
    return { tabId: preferred.id, reused: false };
  }

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
