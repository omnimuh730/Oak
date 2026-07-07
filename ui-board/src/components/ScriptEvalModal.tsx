import './ActionBuilderModal.css';
import './ScriptEvalModal.css';

interface Props {
  pageLabel: string;
  running: boolean;
  output: string | null;
  error: string | null;
  code: string;
  onCodeChange: (code: string) => void;
  onClose: () => void;
  onRun: () => void;
}

const PLACEHOLDER = `// Runs with DOM access through Oak's debugger evaluator.
// __oak pierces same-origin iframes and helps fill inputs.

const input = await __oak.waitFor('[data-oak-id="248"]', 10000);
__oak.setValue(input, 'you@example.com');
return input.value;`;

export function ScriptEvalModal({
  pageLabel,
  running,
  output,
  error,
  code,
  onCodeChange,
  onClose,
  onRun,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div className="modal-panel script-eval-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Script Eval</h2>
            <p className="modal-subtitle">{pageLabel}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={running}>✕</button>
        </header>

        <div className="script-eval-body">
          <p className="script-eval-hint">
            JavaScript runs unsafely with full DOM access through Oak's debugger evaluator; close Chrome DevTools for that tab before running.
          </p>
          <textarea
            className="script-eval-input"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            disabled={running}
          />
          {(output !== null || error) && (
            <div className={`script-eval-output ${error ? 'error' : ''}`}>
              <div className="script-eval-output-label">{error ? 'Error' : 'Result'}</div>
              <pre>{error ?? output}</pre>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" onClick={onClose} disabled={running}>Cancel</button>
          <button
            type="button"
            className="primary danger"
            disabled={running || !code.trim()}
            onClick={onRun}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </footer>
      </div>
    </div>
  );
}
