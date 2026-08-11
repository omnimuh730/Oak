export const DEFAULT_ATHENS_API_URL = 'http://127.0.0.1:8980';
export const OAK_SOCKET_PATH = '/oak';

export type OakStoredSession = {
  accessToken: string;
  username: string;
  displayName: string;
  profileId: string;
  expiresAt: string;
};

const STORAGE_KEYS = {
  apiUrl: 'athensApiUrl',
  session: 'oakSession',
} as const;

export async function getAthensApiUrl(): Promise<string> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiUrl]);
  const value = stored[STORAGE_KEYS.apiUrl];
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\/$/, '')
    : DEFAULT_ATHENS_API_URL;
}

export async function setAthensApiUrl(url: string): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiUrl]: url.trim().replace(/\/$/, ''),
  });
}

export async function getOakSession(): Promise<OakStoredSession | null> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.session]);
  const session = stored[STORAGE_KEYS.session] as OakStoredSession | undefined;
  if (!session?.accessToken) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
    await clearOakSession();
    return null;
  }
  return session;
}

export async function setOakSession(session: OakStoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

export async function clearOakSession(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.session]);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getOakSession();
  return session?.accessToken ?? null;
}

export async function oakSignIn(
  name: string,
  password: string,
  apiUrl?: string,
): Promise<OakStoredSession> {
  const base = (apiUrl || (await getAthensApiUrl())).replace(/\/$/, '');
  const res = await fetch(`${base}/api/oak/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    session?: {
      accessToken?: string;
      username?: string;
      displayName?: string;
      profileId?: string;
      expiresAt?: string;
    };
  };
  if (!res.ok || !data.session?.accessToken) {
    throw new Error(data.message || `Sign in failed (${res.status})`);
  }
  const session: OakStoredSession = {
    accessToken: data.session.accessToken,
    username: data.session.username || name,
    displayName: data.session.displayName || data.session.username || name,
    profileId: data.session.profileId || '',
    expiresAt: data.session.expiresAt || '',
  };
  await setAthensApiUrl(base);
  await setOakSession(session);
  return session;
}

export async function oakSignOut(): Promise<void> {
  const base = await getAthensApiUrl();
  const token = await getAccessToken();
  if (token) {
    try {
      await fetch(`${base}/api/oak/auth/signout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* ignore */
    }
  }
  await clearOakSession();
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to Athens required');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}
