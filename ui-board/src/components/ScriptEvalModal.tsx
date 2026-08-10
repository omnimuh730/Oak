import { useRef, useState } from 'react';
import type { AttachedFile } from '../automation-types';
import type { TokenConsume } from '../token-usage';
import { formatConsumeUsd, formatTokenCount } from '../token-usage';
import './ActionBuilderModal.css';
import './ScriptEvalModal.css';

interface Props {
  pageLabel: string;
  running: boolean;
  output: string | null;
  error: string | null;
  consume: TokenConsume | null;
  code: string;
  files: AttachedFile[];
  onCodeChange: (code: string) => void;
  onFilesChange: (files: AttachedFile[]) => void;
  onClose: () => void;
  onRun: () => void;
  reanalyzeRunning: boolean;
  canReanalyze: boolean;
  onReanalyzeRun: () => void;
}

const PLACEHOLDER = `(function() {
  'use strict';

  function fillAndSubmit() {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    ).set;
    function setValue(el, value) {
      nativeInputValueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // Drop files in the zone below, then use attachDroppedFile(input, 'file_key')
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput && window.attachDroppedFile) {
      window.attachDroppedFile(fileInput, 'eli_taylor');
    }

    const emailInput = document.querySelector('input[type="email"]');
    if (emailInput) setValue(emailInput, 'you@example.com');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(fillAndSubmit, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(fillAndSubmit, 500));
  }
})();`;

const LARGE_FILE_BYTES = 10 * 1024 * 1024;

function fileKeyFromName(name: string, existing: string[]): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'file';
  let key = base;
  let n = 2;
  while (existing.includes(key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsAttached(file: File, existingKeys: string[]): Promise<AttachedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      resolve({
        key: fileKeyFromName(file.name, existingKeys),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function ScriptEvalModal({
  pageLabel,
  running,
  output,
  error,
  consume,
  code,
  files,
  onCodeChange,
  onFilesChange,
  onClose,
  onRun,
  reanalyzeRunning,
  canReanalyze,
  onReanalyzeRun,
}: Props) {
  const [readingFiles, setReadingFiles] = useState(false);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = running || reanalyzeRunning;

  const addFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;

    setReadingFiles(true);
    setFileWarning(null);
    try {
      const next = [...files];
      const existingKeys = next.map((f) => f.key);
      for (const file of incoming) {
        if (file.size > LARGE_FILE_BYTES) {
          setFileWarning(
            `"${file.name}" is ${formatFileSize(file.size)} — large files may slow eval or hit size limits.`,
          );
        }
        const attached = await readFileAsAttached(file, existingKeys);
        existingKeys.push(attached.key);
        next.push(attached);
      }
      onFilesChange(next);
    } catch (err) {
      setFileWarning(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setReadingFiles(false);
    }
  };

  const removeFile = (key: string) => {
    onFilesChange(files.filter((f) => f.key !== key));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (busy || readingFiles) return;
    void addFiles(e.dataTransfer.files);
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal-panel script-eval-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Script Eval</h2>
            <p className="modal-subtitle">{pageLabel}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </header>

        <div className="script-eval-body">
          <p className="script-eval-hint">
            JavaScript runs with full DOM access through Oak's debugger evaluator; close Chrome DevTools for that tab before running. Drop files below, then call <code>attachDroppedFile(input, 'key')</code> in plain JavaScript.
          </p>
          <textarea
            className="script-eval-input"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            disabled={busy}
          />

          <div
            className={`script-eval-dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy && !readingFiles) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !busy && !readingFiles && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="script-eval-file-input"
              disabled={busy || readingFiles}
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {readingFiles ? (
              <span>Reading files…</span>
            ) : (
              <span>Drop files here or click to browse (e.g. Eli Taylor.docx)</span>
            )}
          </div>

          {files.length > 0 && (
            <ul className="script-eval-files">
              {files.map((file) => (
                <li key={file.key} className="script-eval-file-chip">
                  <span className="script-eval-file-key">{file.key}</span>
                  <span className="script-eval-file-name" title={file.name}>{file.name}</span>
                  <span className="script-eval-file-usage">
                    attachDroppedFile(input, '{file.key}')
                  </span>
                  <button
                    type="button"
                    className="script-eval-file-remove"
                    disabled={busy || readingFiles}
                    onClick={() => removeFile(file.key)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {fileWarning && <p className="script-eval-file-warning">{fileWarning}</p>}

          {consume && (
            <div className="script-eval-usage">
              <div className="script-eval-usage-label">AI usage</div>
              <dl className="script-eval-usage-grid">
                <div>
                  <dt>Model</dt>
                  <dd title={consume.pricingModel ?? consume.model}>{consume.model}</dd>
                </div>
                <div>
                  <dt>Input tokens (cached)</dt>
                  <dd>{formatTokenCount(consume.inputCached)}</dd>
                </div>
                <div>
                  <dt>Input tokens (cache miss)</dt>
                  <dd>{formatTokenCount(consume.inputCacheMiss)}</dd>
                </div>
                <div>
                  <dt>Output tokens</dt>
                  <dd>{formatTokenCount(consume.output)}</dd>
                </div>
                <div className="script-eval-usage-consume">
                  <dt>Consume</dt>
                  <dd>
                    {formatConsumeUsd(consume.costUsd)}
                    {!consume.pricingFound && (
                      <span className="script-eval-usage-warning" title="No standard-tier price found in API-Price.md for this model">
                        {' '}pricing unavailable
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {(output !== null || error) && (
            <div className={`script-eval-output ${error ? 'error' : ''}`}>
              <div className="script-eval-output-label">{error ? 'Error' : 'Result'}</div>
              <pre>{error ?? output}</pre>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="secondary"
            disabled={busy || readingFiles || !canReanalyze}
            onClick={onReanalyzeRun}
          >
            {reanalyzeRunning ? 'Reanalyzing...' : 'Analyze Result & Re-run'}
          </button>
          <button
            type="button"
            className="primary danger"
            disabled={busy || readingFiles || !code.trim()}
            onClick={onRun}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </footer>
      </div>
    </div>
  );
}
