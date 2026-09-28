import { useState, type ReactNode } from 'react';
import { shortHex } from '../lib/format';

export function Eyebrow({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  return <div className={`eyebrow${plain ? ' plain' : ''}`}>{children}</div>;
}

export function Panel({
  title,
  actions,
  children,
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <div className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <div className="chart-title">{title}</div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="panel-body">{children}</div> : children}
    </div>
  );
}

export function Tag({
  tone = '',
  children,
  dot = true,
}: {
  tone?: 'ok' | 'bad' | 'warn' | 'accent' | '';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`tag ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/** Copyable machine data — hashes, addresses, tx ids, CIDs. */
export function Hash({
  value,
  head = 10,
  tail = 8,
  full = false,
}: {
  value: string | null | undefined;
  head?: number;
  tail?: number;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="mono faint">—</span>;
  const shown = full ? value : shortHex(value, head, tail);
  return (
    <span className="hash" title={value}>
      <span className="hx">{shown}</span>
      <button
        type="button"
        className="copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            // Clipboard may be unavailable; the full value is in the title.
          }
        }}
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-block error">
      <div className="state-title">{title}</div>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <span className="spin" />
      {label && <span className="mono-xs dim">{label}</span>}
    </span>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <div>{k}</div>
      <div>{v}</div>
    </>
  );
}

export function TypeTag({ type }: { type: string }) {
  const label = type === 'DATASET' ? 'AI DATASET' : type === 'MODEL' ? 'ML MODEL' : 'SOFTWARE';
  return <Tag dot={false}>{label}</Tag>;
}

export function RiskTag({ level, score }: { level: string | null | undefined; score?: number }) {
  if (!level) return <span className="mono-xs faint">NOT ANALYZED</span>;
  const tone = level === 'LOW' ? 'ok' : level === 'MEDIUM' ? 'warn' : 'bad';
  return (
    <Tag tone={tone as 'ok'}>
      {level}
      {typeof score === 'number' ? ` ${score.toFixed(2)}` : ''}
    </Tag>
  );
}
