import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ActionStep } from './automation-types';
import type { ClientInfo, DomNode, DomTreeMessage, HighlightPayload } from './types';
import {
  formatMetaTreePreview,
  formatPureTreeForAnalyze,
  formatPureTreePreview,
  splitDomTree,
} from './tree-export';
import { ActionBuilderModal } from './components/ActionBuilderModal';
import { ContentModal } from './components/ContentModal';
import { ContextMenu, type ContextMenuState } from './components/ContextMenu';
import { DomTreeView } from './components/DomTreeView';
import { ScriptEvalModal } from './components/ScriptEvalModal';
import './App.css';

const DEFAULT_SERVER = 'http://localhost:3847';

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [latestTree, setLatestTree] = useState<DomTreeMessage | null>(null);
  const [history, setHistory] = useState<DomTreeMessage[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextNode, setContextNode] = useState<DomNode | null>(null);
  const [contentModal, setContentModal] = useState<{ title: string; content: string } | null>(null);
  const [actionModalNode, setActionModalNode] = useState<DomNode | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [scriptEvalOpen, setScriptEvalOpen] = useState(false);
  const [scriptEvalCode, setScriptEvalCode] = useState('');
  const [scriptEvalOakNodeId, setScriptEvalOakNodeId] = useState<number | null>(null);
  const [scriptEvalRunning, setScriptEvalRunning] = useState(false);
  const [scriptEvalOutput, setScriptEvalOutput] = useState<string | null>(null);
  const [scriptEvalError, setScriptEvalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
      setSelectedNodeId(null);
      setHistory((prev) => [payload, ...prev].slice(0, 20));
    });

    return () => {
      socket.disconnect();
    };
  }, [serverUrl]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const getTarget = useCallback(
    (node: DomNode) => {
      const tabId = latestTree?.meta?.tabId ?? latestTree?.tabId;
      if (!tabId || !latestTree) return null;
      return {
        nodeId: node.nodeId,
        tabId,
        url: latestTree.url,
        extensionId: latestTree.meta?.from,
      };
    },
    [latestTree],
  );

  const handleNodeClick = useCallback(
    (node: DomNode) => {
      const target = getTarget(node);
      if (!target) return;

      setSelectedNodeId(node.nodeId);
      socketRef.current?.emit('dom:highlight', target satisfies HighlightPayload);
    },
    [getTarget],
  );

  const handleNodeContextMenu = useCallback((node: DomNode, x: number, y: number) => {
    setContextNode(node);
    setSelectedNodeId(node.nodeId);
    setContextMenu({ x, y, nodeLabel: formatNodeLabel(node) });
  }, []);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const fetchContent = (contentType: 'innerHTML' | 'innerText') => {
    if (!contextNode) return;
    const target = getTarget(contextNode);
    if (!target) {
      showToast('No active page session');
      return;
    }

    closeContextMenu();
    const socket = socketRef.current;
    if (!socket) return;

    socket.timeout(15000).emit(
      'dom:get-content',
      { ...target, contentType },
      (err: Error | null, res: { content?: string; error?: string }) => {
        if (err) {
          showToast(err.message ?? 'Request failed');
          return;
        }
        if (res?.error) {
          showToast(res.error);
          return;
        }
        setContentModal({
          title: contentType === 'innerHTML' ? 'Element HTML' : 'Inner Text',
          content: res?.content ?? '',
        });
      },
    );
  };

  const runActions = (steps: ActionStep[]) => {
    if (!actionModalNode) return;
    const target = getTarget(actionModalNode);
    if (!target) {
      showToast('No active page session');
      return;
    }

    const socket = socketRef.current;
    if (!socket) return;

    setActionRunning(true);
    const totalWait = steps
      .filter((s) => s.type === 'wait')
      .reduce((sum, s) => sum + (s.ms ?? 0), 0);
    const timeout = Math.max(15000, totalWait + 10000);

    socket.timeout(timeout).emit(
      'dom:execute-actions',
      {
        ...target,
        steps: steps.map(({ type, text, ms, key }) => ({ type, text, ms, key })),
      },
      (err: Error | null, res: { ok?: boolean; error?: string }) => {
        setActionRunning(false);
        if (err) {
          showToast(err.message ?? 'Action failed');
          return;
        }
        if (res?.error) {
          showToast(res.error);
          return;
        }
        showToast('Actions completed');
        setActionModalNode(null);
      },
    );
  };

  const openScriptEval = (oakNodeId?: number) => {
    closeContextMenu();
    setScriptEvalOutput(null);
    setScriptEvalError(null);
    setScriptEvalOakNodeId(oakNodeId ?? null);
    setScriptEvalOpen(true);
  };

  const closeScriptEval = () => {
    if (scriptEvalRunning) return;
    setScriptEvalOpen(false);
    setScriptEvalOakNodeId(null);
    setScriptEvalOutput(null);
    setScriptEvalError(null);
  };

  const runScriptEval = () => {
    if (!latestTree || !scriptEvalCode.trim()) return;

    const tabId = latestTree.meta?.tabId ?? latestTree.tabId;
    const frameId = latestTree.meta?.frameId ?? latestTree.frameId;
    if (!tabId) {
      showToast('No active page session');
      return;
    }

    const socket = socketRef.current;
    if (!socket) return;

    setScriptEvalRunning(true);
    setScriptEvalOutput(null);
    setScriptEvalError(null);

    socket.timeout(60000).emit(
      'dom:eval-script',
      {
        tabId,
        frameId: frameId ?? undefined,
        oakNodeId: scriptEvalOakNodeId ?? undefined,
        url: latestTree.url,
        code: scriptEvalCode,
        extensionId: latestTree.meta?.from,
      },
      (err: Error | null, res: { ok?: boolean; result?: string; error?: string }) => {
        setScriptEvalRunning(false);
        if (err) {
          setScriptEvalError(err.message ?? 'Request failed');
          return;
        }
        if (res?.error) {
          setScriptEvalError(res.error);
          return;
        }
        if (res?.result === undefined) {
          setScriptEvalError('Script eval returned no result');
          return;
        }
        setScriptEvalOutput(res.result);
      },
    );
  };

  const nodeCount = latestTree?.meta?.nodeCount ?? countNodes(latestTree?.tree);

  const splitTrees = useMemo(() => {
    if (!latestTree?.tree) return null;
    return splitDomTree(latestTree.tree);
  }, [latestTree]);

  const copyForAnalyze = async () => {
    if (!latestTree || !splitTrees) return;
    const text = formatPureTreeForAnalyze(splitTrees.pure, {
      title: latestTree.title || 'Untitled',
      url: latestTree.url,
      fetchedAt: latestTree.fetchedAt,
    });
    await navigator.clipboard.writeText(text);
    showToast('Copied for analyze');
  };

  const openPureTreeModal = () => {
    if (!splitTrees) return;
    setContentModal({
      title: 'Pure Tree',
      content: formatPureTreePreview(splitTrees.pure),
    });
  };

  const openMetaTreeModal = () => {
    if (!splitTrees) return;
    setContentModal({
      title: 'Meta Tree',
      content: formatMetaTreePreview(splitTrees.meta, splitTrees.pure),
    });
  };

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
            <div className="tree-actions">
              <button type="button" onClick={openPureTreeModal}>Pure Tree</button>
              <button type="button" onClick={openMetaTreeModal}>Meta Tree</button>
              <button type="button" onClick={() => openScriptEval()}>Script Eval</button>
              <button type="button" className="primary" onClick={copyForAnalyze}>
                Copy for Analyze
              </button>
            </div>
          </>
        )}
      </div>

      <main className="main">
        {latestTree ? (
          <DomTreeView
            tree={latestTree.tree}
            selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick}
            onNodeContextMenu={handleNodeContextMenu}
          />
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

      <ContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        onGetInnerHtml={() => fetchContent('innerHTML')}
        onGetInnerText={() => fetchContent('innerText')}
        onScriptEval={() => openScriptEval(contextNode?.nodeId)}
        onAction={() => {
          closeContextMenu();
          if (contextNode) setActionModalNode(contextNode);
        }}
      />

      {contentModal && (
        <ContentModal
          title={contentModal.title}
          content={contentModal.content}
          onClose={() => setContentModal(null)}
        />
      )}

      {actionModalNode && (
        <ActionBuilderModal
          nodeLabel={formatNodeLabel(actionModalNode)}
          running={actionRunning}
          onClose={() => !actionRunning && setActionModalNode(null)}
          onRun={runActions}
        />
      )}

      {scriptEvalOpen && latestTree && (
        <ScriptEvalModal
          pageLabel={latestTree.title || latestTree.url}
          running={scriptEvalRunning}
          output={scriptEvalOutput}
          error={scriptEvalError}
          code={scriptEvalCode}
          onCodeChange={setScriptEvalCode}
          onClose={closeScriptEval}
          onRun={runScriptEval}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function formatNodeLabel(node: DomNode): string {
  let label = `<${node.tag}`;
  if (node.id) label += `#${node.id}`;
  if (node.classes?.length) label += `.${node.classes[0]}`;
  label += '>';
  return label;
}

function countNodes(node: DomTreeMessage['tree'] | undefined): number {
  if (!node) return 0;
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}
