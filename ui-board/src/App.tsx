import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientInfo, DomTreeMessage } from './types';
import { DomTreeView } from './components/DomTreeView';
import './App.css';

const DEFAULT_SERVER = 'http://localhost:3847';

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [latestTree, setLatestTree] = useState<DomTreeMessage | null>(null);
  const [history, setHistory] = useState<DomTreeMessage[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(serverUrl, {
      query: { type: 'ui-board', name: 'Oak UI Board' },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('clients:update', (list: ClientInfo[]) => setClients(list));
    socket.on('connected', (data: { clients: ClientInfo[] }) => setClients(data.clients));
    socket.on('dom:tree', (payload: DomTreeMessage) => {
      setLatestTree(payload);
      setHistory((prev) => [payload, ...prev].slice(0, 20));
    });

    return () => {
      socket.disconnect();
    };
  }, [serverUrl]);

  const nodeCount = latestTree?.meta?.nodeCount ?? countNodes(latestTree?.tree);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">🌳</div>
          <div>
            <h1>Oak DOM Tree Board</h1>
            <p className="subtitle">Live DOM snapshots from the Chrome extension</p>
          </div>
        </div>
        <div className="header-right">
          <div className="server-input">
            <label htmlFor="server">Server</label>
            <input
              id="server"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3847"
            />
          </div>
          <div className={`status ${connected ? 'online' : 'offline'}`}>
            <span className="dot" />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </header>

      <div className="meta-bar">
        <div className="meta-item">
          <span className="meta-label">Clients</span>
          <span className="meta-value">{clients.length}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Extensions</span>
          <span className="meta-value">
            {clients.filter((c) => c.type === 'extension').length}
          </span>
        </div>
        {latestTree && (
          <>
            <div className="meta-item wide">
              <span className="meta-label">Page</span>
              <span className="meta-value truncate" title={latestTree.url}>
                {latestTree.title || latestTree.url}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Nodes</span>
              <span className="meta-value">{nodeCount}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Fetched</span>
              <span className="meta-value">
                {new Date(latestTree.fetchedAt).toLocaleTimeString()}
              </span>
            </div>
          </>
        )}
      </div>

      <main className="main">
        {latestTree ? (
          <DomTreeView tree={latestTree.tree} />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <h2>Waiting for DOM tree</h2>
            <p>
              Open the Oak Chrome extension on any page and click
              <strong> Fetch DOM</strong> to see the tree here.
            </p>
          </div>
        )}
      </main>

      {history.length > 1 && (
        <aside className="history">
          <h3>History</h3>
          <ul>
            {history.map((item, i) => (
              <li key={`${item.fetchedAt}-${i}`}>
                <button
                  type="button"
                  className={item === latestTree ? 'active' : ''}
                  onClick={() => setLatestTree(item)}
                >
                  <span className="hist-title">{item.title || 'Untitled'}</span>
                  <span className="hist-time">
                    {new Date(item.fetchedAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

function countNodes(node: DomTreeMessage['tree'] | undefined): number {
  if (!node) return 0;
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}
