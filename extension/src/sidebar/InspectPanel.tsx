interface InspectPanelProps {
  title: string;
  content: string;
  onClose(): void;
}

export function InspectPanel({ title, content, onClose }: InspectPanelProps) {
  const copy = async () => {
    await navigator.clipboard.writeText(content);
  };

  return (
    <div className="inspect-panel">
      <header className="inspect-header">
        <h3>{title}</h3>
        <button type="button" className="inspect-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <pre className="inspect-pre">{content || '(empty)'}</pre>
      <footer className="inspect-footer">
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  );
}
