export type OakTabJobBinding = {
  jobId: string;
  resumeId: string | null;
  resumeStack: string | null;
  applyUrl: string;
  title: string;
  company: string;
};

export type JobAttachment = {
  tabId: number;
  active: boolean;
};

export const TAB_JOBS_STORAGE_KEY = 'oakTabJobs';

export type TabJobMap = Record<string, OakTabJobBinding>;

async function readMap(): Promise<TabJobMap> {
  const stored = await chrome.storage.session.get(TAB_JOBS_STORAGE_KEY);
  const raw = stored[TAB_JOBS_STORAGE_KEY];
  return raw && typeof raw === 'object' ? (raw as TabJobMap) : {};
}

export async function listTabJobs(): Promise<TabJobMap> {
  return readMap();
}

export async function bindTabJob(
  tabId: number,
  job: OakTabJobBinding,
): Promise<void> {
  const map = await readMap();
  map[String(tabId)] = job;
  await chrome.storage.session.set({ [TAB_JOBS_STORAGE_KEY]: map });
}

export async function getTabJob(
  tabId: number,
): Promise<OakTabJobBinding | null> {
  const map = await readMap();
  return map[String(tabId)] ?? null;
}

export async function findTabIdForJob(jobId: string): Promise<number | null> {
  const map = await readMap();
  for (const [tabId, job] of Object.entries(map)) {
    if (job.jobId === jobId) {
      const id = Number(tabId);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

export async function unbindTabJob(tabId: number): Promise<void> {
  const map = await readMap();
  if (!(String(tabId) in map)) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [TAB_JOBS_STORAGE_KEY]: map });
}

export async function unbindJobFromAllTabs(jobId: string): Promise<void> {
  const map = await readMap();
  let changed = false;
  for (const [tabId, job] of Object.entries(map)) {
    if (job.jobId !== jobId) continue;
    delete map[tabId];
    changed = true;
  }
  if (changed) {
    await chrome.storage.session.set({ [TAB_JOBS_STORAGE_KEY]: map });
  }
}
