import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ATHENS_API_URL,
  getAthensApiUrl,
  getOakSession,
  setAthensApiUrl,
  type OakStoredSession,
} from '../auth/oak-auth';
import { MSG, type DomNode, type DomTreePayload } from '../types';
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

  const nodeCount = lastFetch ? countNodes(lastFetch.tree) : 0;

  return (
    <div className="sidebar-app">
      <section className="welcome">
        <h2>Welcome</h2>
        <p className="hint">
          Sign in with your Athens account, then capture the page DOM for the Oak UI Board.
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
              disabled={authBusy}
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

      <section className="tools">
        <h3>Tools</h3>
        <div className="tool-grid">
          <button
            type="button"
            className="tool-card primary"
            onClick={fetchDom}
            disabled={fetching || !connected || !session}
          >
            <span className="tool-icon">⬡</span>
            <span className="tool-label">{fetching ? 'Fetching…' : 'Fetch DOM'}</span>
          </button>
        </div>
      </section>

      {lastFetch && isValidTree(lastFetch.tree) && (
        <section className="preview">
          <h3>Last Snapshot</h3>
          <div className="preview-card">
            <div className="preview-title">{String(lastFetch.title ?? 'Untitled')}</div>
            <div className="preview-url">{String(lastFetch.url ?? '')}</div>
            <div className="preview-meta">
              <span>{nodeCount} nodes</span>
              <span>{new Date(lastFetch.fetchedAt).toLocaleTimeString()}</span>
            </div>
            <div className="mini-tree">
              <MiniNode node={lastFetch.tree} depth={0} />
            </div>
          </div>
        </section>
      )}

      <footer className="status-bar">
        <span>{status}</span>
      </footer>
    </div>
  );
}

function MiniNode({ node, depth }: { node: DomNode; depth: number }) {
  if (depth > 2 || !node) return null;

  const children = Array.isArray(node.children) ? node.children : [];

  return (
    <div className="mini-node" style={{ paddingLeft: depth * 12 }}>
      <span className="mini-tag">&lt;{String(node.tag ?? 'unknown')}&gt;</span>
      {typeof node.text === 'string' && node.text.length > 0 && (
        <span className="mini-text"> &quot;{node.text}&quot;</span>
      )}
      {children.slice(0, 3).map((c) => (
        <MiniNode key={`oak-node-${c.nodeId}`} node={c} depth={depth + 1} />
      ))}
      {children.length > 3 && (
        <div className="mini-node" style={{ paddingLeft: (depth + 1) * 12 }}>
          …
        </div>
      )}
    </div>
  );
}

function isValidTree(tree: unknown): tree is DomNode {
  return Boolean(tree && typeof tree === 'object' && 'tag' in (tree as object));
}

function countNodes(node: DomNode | undefined): number {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}
