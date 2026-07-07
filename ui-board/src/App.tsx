import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ActionStep, AttachedFile } from './automation-types';
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
const DEFAULT_AI_SERVER = import.meta.env.VITE_AI_SERVER_URL || 'http://localhost:3848';
const RESUME_FILE_KEY = 'eli_taylor';

interface GenerateEvalScriptResponse {
  ok?: boolean;
  code?: string;
  responseId?: string | null;
  error?: string;
}

interface ResumeAttachmentResponse {
  file?: AttachedFile;
  error?: string;
}

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
  const [scriptEvalFiles, setScriptEvalFiles] = useState<AttachedFile[]>([]);
  const [scriptEvalOakNodeId, setScriptEvalOakNodeId] = useState<number | null>(null);
  const [scriptEvalRunning, setScriptEvalRunning] = useState(false);
  const [autoGenerateRunning, setAutoGenerateRunning] = useState(false);
  const [reanalyzeRunning, setReanalyzeRunning] = useState(false);
  const [scriptEvalAiResponseId, setScriptEvalAiResponseId] = useState<string | null>(null);
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
    setScriptEvalFiles([]);
    setScriptEvalAiResponseId(null);
    setScriptEvalOutput(null);
    setScriptEvalError(null);
  };

  const runScriptEval = useCallback(
    (override?: { code?: string; files?: AttachedFile[]; oakNodeId?: number | null }) => {
      const code = override?.code ?? scriptEvalCode;
      const files = override?.files ?? scriptEvalFiles;
      const oakNodeId = override?.oakNodeId ?? scriptEvalOakNodeId;
      if (!latestTree || !code.trim()) return;

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
          oakNodeId: oakNodeId ?? undefined,
          url: latestTree.url,
          code,
          extensionId: latestTree.meta?.from,
          files: files.length ? files : undefined,
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
          setScriptEvalOutput(formatEvalOutput(res.result));
        },
      );
    },
    [latestTree, scriptEvalCode, scriptEvalFiles, scriptEvalOakNodeId],
  );

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

  const handleAutoGenerateRun = async () => {
    if (!latestTree || !splitTrees) return;

    setAutoGenerateRunning(true);
    setScriptEvalOutput(null);
    setScriptEvalError(null);

    try {
      const analyzeText = formatPureTreeForAnalyze(splitTrees.pure, {
        title: latestTree.title || 'Untitled',
        url: latestTree.url,
        fetchedAt: latestTree.fetchedAt,
      });

      const generation = await fetchJson<GenerateEvalScriptResponse>(
        `${DEFAULT_AI_SERVER}/api/generate-eval-script`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analyzeText,
            page: {
              title: latestTree.title || 'Untitled',
              url: latestTree.url,
              fetchedAt: latestTree.fetchedAt,
            },
            resumeKey: RESUME_FILE_KEY,
          }),
        },
      );

      const generatedCode = generation.code?.trim();
      if (!generatedCode) {
        throw new Error(generation.error || 'AI backend returned no eval script');
      }

      const filesForRun = await ensureRuntimeResumeFile(generatedCode, scriptEvalFiles);
      setScriptEvalCode(generatedCode);
      setScriptEvalFiles(filesForRun);
      setScriptEvalOakNodeId(null);
      setScriptEvalAiResponseId(generation.responseId ?? null);
      setScriptEvalOpen(true);
      showToast('Generated eval script; running now');

      runScriptEval({ code: generatedCode, files: filesForRun, oakNodeId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setScriptEvalOpen(true);
      setScriptEvalError(message);
      showToast('Auto generate run failed');
    } finally {
      setAutoGenerateRunning(false);
    }
  };

  const handleAnalyzeResultAndRerun = async () => {
    if (!latestTree || !splitTrees || !scriptEvalCode.trim()) return;
    if (scriptEvalOutput === null && !scriptEvalError) {
      showToast('No eval result to analyze');
      return;
    }

    setReanalyzeRunning(true);
    setScriptEvalError(null);

    try {
      const analyzeText = formatPureTreeForAnalyze(splitTrees.pure, {
        title: latestTree.title || 'Untitled',
        url: latestTree.url,
        fetchedAt: latestTree.fetchedAt,
      });

      const generation = await fetchJson<GenerateEvalScriptResponse>(
        `${DEFAULT_AI_SERVER}/api/repair-eval-script`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            previousResponseId: scriptEvalAiResponseId,
            currentCode: scriptEvalCode,
            evalResult: scriptEvalOutput,
            evalError: scriptEvalError,
            analyzeText,
            page: {
              title: latestTree.title || 'Untitled',
              url: latestTree.url,
              fetchedAt: latestTree.fetchedAt,
            },
            resumeKey: RESUME_FILE_KEY,
          }),
        },
      );

      const repairedCode = generation.code?.trim();
      if (!repairedCode) {
        throw new Error(generation.error || 'AI backend returned no repaired eval script');
      }

      const filesForRun = await ensureRuntimeResumeFile(repairedCode, scriptEvalFiles);
      setScriptEvalCode(repairedCode);
      setScriptEvalFiles(filesForRun);
      setScriptEvalAiResponseId(generation.responseId ?? scriptEvalAiResponseId);
      showToast('Reanalyzed result; running repair once');

      runScriptEval({ code: repairedCode, files: filesForRun, oakNodeId: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setScriptEvalError(message);
      showToast('Reanalyze run failed');
    } finally {
      setReanalyzeRunning(false);
    }
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
              <button
                type="button"
                className="primary"
                disabled={autoGenerateRunning || scriptEvalRunning}
                onClick={handleAutoGenerateRun}
              >
                {autoGenerateRunning
                  ? 'Generating...'
                  : scriptEvalRunning
                    ? 'Running...'
                    : 'Auto Generate Run'}
              </button>
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
          files={scriptEvalFiles}
          onCodeChange={setScriptEvalCode}
          onFilesChange={setScriptEvalFiles}
          onClose={closeScriptEval}
          onRun={runScriptEval}
          reanalyzeRunning={reanalyzeRunning}
          canReanalyze={Boolean(scriptEvalCode.trim() && (scriptEvalOutput !== null || scriptEvalError))}
          onReanalyzeRun={handleAnalyzeResultAndRerun}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

function formatEvalOutput(output: string | undefined): string {
  if (output === undefined || output.trim() === 'undefined') {
    return JSON.stringify({ ok: true, result: 'Script completed without return value' }, null, 2);
  }
  return output;
}

async function ensureRuntimeResumeFile(code: string, existingFiles: AttachedFile[]): Promise<AttachedFile[]> {
  if (!usesRuntimeResumeFile(code) || existingFiles.some((file) => file.key === RESUME_FILE_KEY)) {
    return existingFiles;
  }

  const data = await fetchJson<ResumeAttachmentResponse>(
    `${DEFAULT_AI_SERVER}/api/resume-attachment`,
  );
  if (!data.file) {
    throw new Error(data.error || `AI backend did not return ${RESUME_FILE_KEY}`);
  }

  return [
    ...existingFiles.filter((file) => file.key !== data.file?.key),
    data.file,
  ];
}

function usesRuntimeResumeFile(code: string): boolean {
  return (
    code.includes('attachDroppedFile') ||
    code.includes(`'${RESUME_FILE_KEY}'`) ||
    code.includes(`"${RESUME_FILE_KEY}"`)
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
