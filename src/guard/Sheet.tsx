/**
 * The guard app's own dialogs. Native confirm()/prompt() block the page, look
 * like a website and, in an iPhone Home Screen app, can be suppressed — so
 * every question the app asks is one of these bottom sheets.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="g-sheet-wrap" onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="g-sheet-grip" />
        <div className="g-sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="g-sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirm, danger, onConfirm, onCancel }: { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="muted" style={{ margin: 0 }}>
        {body}
      </p>
      <div className="g-sheet-actions">
        <button className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button className={`btn btn-lg ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </Sheet>
  );
}

export function AskReason({ title, body, placeholder, confirm, quick = [], onSubmit, onCancel }: { title: string; body: string; placeholder: string; confirm: string; quick?: string[]; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="muted" style={{ margin: 0 }}>
        {body}
      </p>
      {quick.length > 0 && (
        <div className="g-quick">
          {quick.map((q) => (
            <button key={q} className={`g-quick-chip${text === q ? ' is-on' : ''}`} onClick={() => setText(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <textarea ref={ref} className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      <div className="g-sheet-actions">
        <button className="btn btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-lg" disabled={text.trim().length < 3} onClick={() => onSubmit(text.trim())}>
          {confirm}
        </button>
      </div>
    </Sheet>
  );
}
