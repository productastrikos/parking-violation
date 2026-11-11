/**
 * The advisory row (theme §10.1 .adv-row): rank tile · title + sub · priority
 * chip · chevron; expanded: "Why this ranks here", evidence, actions, impact,
 * and the action button. Shared by the header popover and the AI Advisory page.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Advisory, AdvisoryPriority } from '../lib/api';

export const PRIORITY: Record<AdvisoryPriority, { label: string; chip: string; tone: string }> = {
  critical: { label: 'Critical', chip: 'chip-danger', tone: 'danger' },
  high: { label: 'High', chip: 'chip-warning', tone: 'warning' },
  predictive: { label: 'Predictive', chip: 'chip-advisory', tone: 'accent' },
  medium: { label: 'Medium', chip: 'chip-info', tone: 'info' },
  info: { label: 'Info', chip: '', tone: 'info' },
};

export function AdvisoryRow({ a, rank, onAct, defaultOpen = false }: { a: Advisory; rank: number; onAct: (a: Advisory) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const p = PRIORITY[a.priority];
  return (
    <li className={`adv-row${open ? ' is-open' : ''}`}>
      <div className="adv-head">
        <span className="adv-rank">{rank}</span>
        <button className="adv-main" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="adv-title">{a.title}</span>
          <span className="adv-sub">
            {a.kind} · confidence {a.confidence}%
          </span>
        </button>
        <span className={`chip ${p.chip}`}>{p.label}</span>
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {open && (
        <div className="adv-body">
          <div className="adv-why">Why this ranks here</div>
          <ul className="adv-reasons">
            {a.rootCause.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
            {a.evidence.map((r, i) => (
              <li key={`e${i}`} className="faint">
                {r}
              </li>
            ))}
          </ul>
          {a.actions.length > 0 && (
            <>
              <div className="adv-why">Recommended</div>
              <ol className="adv-reasons">
                {a.actions.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </>
          )}
          {a.impact && <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>Impact: {a.impact}</div>}
          {a.cta && (
            <button className="btn btn-sm btn-primary" onClick={() => onAct(a)}>
              {a.cta.label} →
            </button>
          )}
        </div>
      )}
    </li>
  );
}
