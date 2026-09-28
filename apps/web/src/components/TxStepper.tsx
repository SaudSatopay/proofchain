/**
 * Transaction lifecycle display. The UI never claims success before the
 * receipt confirms — each stage reflects the actual pipeline state.
 */
export type TxPhase =
  | 'idle'
  | 'hashing'
  | 'storing'
  | 'signing'
  | 'pending'
  | 'confirmed'
  | 'failed';

const STEPS: { key: TxPhase; label: string; detail: string }[] = [
  { key: 'hashing', label: 'PREPARING', detail: 'SHA-256 / Merkle fingerprint computed' },
  { key: 'storing', label: 'STORING', detail: 'files + metadata → storage layer' },
  { key: 'signing', label: 'SIGNING', detail: 'awaiting signature' },
  { key: 'pending', label: 'PENDING', detail: 'transaction broadcast, awaiting confirmation' },
  { key: 'confirmed', label: 'CONFIRMED', detail: 'event read back from the chain' },
];

const ORDER: TxPhase[] = ['hashing', 'storing', 'signing', 'pending', 'confirmed'];

export function TxStepper({ phase, error, txHash }: { phase: TxPhase; error?: string | null; txHash?: string | null }) {
  if (phase === 'idle') return null;
  const activeIdx = ORDER.indexOf(phase === 'failed' ? 'signing' : phase);

  return (
    <div className="stepper panel" style={{ padding: '4px 20px' }} aria-live="polite">
      {STEPS.map((step, i) => {
        const isDone = phase === 'confirmed' ? i <= activeIdx : i < activeIdx;
        const isActive = phase !== 'failed' && phase !== 'confirmed' && i === activeIdx;
        const isFailed = phase === 'failed' && i === Math.max(activeIdx, 0);
        return (
          <div
            key={step.key}
            className={`step${isDone ? ' done' : ''}${isActive ? ' active' : ''}${isFailed ? ' failed' : ''}`}
          >
            <span className="s-ind">{isDone ? '✓' : isFailed ? '✕' : i + 1}</span>
            <span style={{ minWidth: 96 }}>{step.label}</span>
            <span className="mono-xs" style={{ color: 'inherit', opacity: 0.75 }}>
              {isFailed && error ? error : step.detail}
              {step.key === 'pending' && txHash && (isActive || isDone) ? ` · ${txHash.slice(0, 14)}…` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
