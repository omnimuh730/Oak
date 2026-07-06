import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { DEFAULT_SERVER, MSG, type DomTreePayload } from '../types';
import './SidebarApp.css';

export default function SidebarApp() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [lastFetch, setLastFetch] = useState<DomTreePayload | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    chrome.storage.local.get(['serverUrl'], (result) => {
      if (result.serverUrl) setServerUrl(result.serverUrl);
    });
  }, []);

  useEffect(() => {
    chrome.storage.local.set({ serverUrl });

    const socket = io(serverUrl, {
      query: { type: 'extension', name: 'Oak Extension' },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('Connected to backend');
    });
    socket.on('disconnect', () => {
      setConnected(false);
      setStatus('Disconnected from backend');
    });
    socket.on('dom:tree:sent', (meta) => {
      setStatus(`Sent ${meta.nodeCount} nodes to UI board`);
    });

    return () => { socket.disconnect(); };
  }, [serverUrl]);

  const fetchDom = useCallback(async () => {
    setFetching(true);
    setStatus('Fetching DOM…');

    try {
      const response = await chrome.runtime.sendMessage({ type: MSG.FETCH_DOM });

      if (response?.error) {
        setStatus(`Error: ${response.error}`);
        return;
      }

      const payload: DomTreePayload = response;
      setLastFetch(payload);

      socketRef.current?.emit('dom:tree', payload);
      setStatus('DOM fetched — sending to board…');
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setFetching(false);
    }
  }, []);

  const nodeCount = lastFetch ? countNodes(lastFetch.tree) : 0;

  return (
    <div className="sidebar-app">
      <section className="welcome">
        <h2>Welcome 👋</h2>
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

      {lastFetch && (
        <section className="preview">
          <h3>Last Snapshot</h3>
          <div className="preview-card">
            <div className="preview-title">{lastFetch.title}</div>
            <div className="preview-url">{lastFetch.url}</div>
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

function MiniNode({ node, depth }: { node: DomTreePayload['tree']; depth: number }) {
  if (depth > 2) return null;
  return (
    <div className="mini-node" style={{ paddingLeft: depth * 12 }}>
      <span className="mini-tag">&lt;{node.tag}&gt;</span>
      {node.children.slice(0, 3).map((c, i) => (
        <MiniNode key={i} node={c} depth={depth + 1} />
      ))}
      {node.children.length > 3 && (
        <div className="mini-node" style={{ paddingLeft: (depth + 1) * 12 }}>
          <span className="mini-more">+{node.children.length - 3} more</span>
        </div>
      )}
    </div>
  );
}

function countNodes(node: DomTreePayload['tree']): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}
