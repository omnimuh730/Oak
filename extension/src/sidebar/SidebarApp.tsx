import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SERVER, MSG, type DomNode, type DomTreePayload } from '../types';
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
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [lastFetch, setLastFetch] = useState<DomTreePayload | null>(null);

  useEffect(() => {
    chrome.storage.local.get(['serverUrl'], (result) => {
      if (result.serverUrl) setServerUrl(String(result.serverUrl));
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ serverUrl });
  }, [serverUrl]);

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
  }, [serverUrl]);

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
        <p className="hint">Capture the current page DOM and visualize it on the Oak UI Board.</p>
      </section>

      <section className="tools">
        <h3>Tools</h3>
        <div className="tool-grid">
          <button
            type="button"
            className="tool-card primary"
            onClick={fetchDom}
            disabled={fetching || !connected}
          >
            <span className="tool-icon">⬡</span>
            <span className="tool-label">{fetching ? 'Fetching…' : 'Fetch DOM'}</span>
          </button>
          <button type="button" className="tool-card" disabled>
            <span className="tool-icon">✎</span>
            <span className="tool-label">Write</span>
          </button>
          <button type="button" className="tool-card" disabled>
            <span className="tool-icon">🌐</span>
            <span className="tool-label">Translate</span>
          </button>
          <button type="button" className="tool-card" disabled>
            <span className="tool-icon">🔍</span>
            <span className="tool-label">Search</span>
          </button>
        </div>
      </section>

      <section className="connection">
        <h3>Connection</h3>
        <label className="field">
          <span>Backend URL</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3847"
          />
        </label>
        <div className={`conn-status ${connected ? 'on' : 'off'}`}>
          <span className="dot" />
          {connected ? 'Backend connected' : 'Backend offline'}
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
      {children.slice(0, 3).map((c, i) => (
        <MiniNode key={`${c.path?.join('-') ?? i}`} node={c} depth={depth + 1} />
      ))}
      {children.length > 3 && (
        <div className="mini-node" style={{ paddingLeft: (depth + 1) * 12 }}>
          <span className="mini-more">+{children.length - 3} more</span>
        </div>
      )}
    </div>
  );
}

function isValidTree(node: unknown): node is DomNode {
  if (!node || typeof node !== 'object') return false;
  const n = node as DomNode;
  return typeof n.tag === 'string' && Array.isArray(n.children);
}

function countNodes(node: DomNode | undefined): number {
  if (!node || !Array.isArray(node.children)) return 0;
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}
