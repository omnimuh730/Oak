export type OakTabJobBinding = {
  jobId: string;
  resumeId: string | null;
  applyUrl: string;
  title: string;
  company: string;
};

const STORAGE_KEY = 'oakTabJobs';

type TabJobMap = Record<string, OakTabJobBinding>;

async function readMap(): Promise<TabJobMap> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  return raw && typeof raw === 'object' ? (raw as TabJobMap) : {};
}

export async function bindTabJob(
  tabId: number,
  job: OakTabJobBinding,
): Promise<void> {
  const map = await readMap();
  map[String(tabId)] = job;
  await chrome.storage.session.set({ [STORAGE_KEY]: map });
}

export async function getTabJob(
  tabId: number,
): Promise<OakTabJobBinding | null> {
  const map = await readMap();
  return map[String(tabId)] ?? null;
}

export async function unbindTabJob(tabId: number): Promise<void> {
  const map = await readMap();
  if (!(String(tabId) in map)) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [STORAGE_KEY]: map });
}
