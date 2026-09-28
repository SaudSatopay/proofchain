import type { AiAnalysisResult } from '@proofchain/types';
import { formatDate, RISK_COLOR } from '../lib/format';
import { Tag } from './ui';

export function RiskPanel({ analysis }: { analysis: AiAnalysisResult }) {
  const color = RISK_COLOR[analysis.riskLevel] ?? 'var(--warn)';
  return (
    <div className="stack reveal" data-testid="risk-panel">
      <div className="row" style={{ gap: 28, alignItems: 'flex-end' }}>
        <div>
          <div className="mono-xs faint">ANOMALY SCORE</div>
          <div
            className="display"
            style={{ fontSize: 56, color, lineHeight: 1, letterSpacing: '-0.03em' }}
          >
            {analysis.riskScore.toFixed(2)}
          </div>
        </div>
        <div className="stack-sm" style={{ paddingBottom: 6 }}>
          <Tag tone={analysis.riskLevel === 'LOW' ? 'ok' : analysis.riskLevel === 'MEDIUM' ? 'warn' : 'bad'}>
            RISK {analysis.riskLevel}
          </Tag>
          <div className="mono-xs dim">
            MODEL {analysis.modelVersion} · {analysis.mode} · {analysis.sampleCount} samples ·{' '}
            {analysis.featureCount} features
          </div>
          <div className="mono-xs faint">{formatDate(analysis.analyzedAt)}</div>
        </div>
      </div>

      <div className="risk-meter">
        <div className="risk-track">
          <div
            className="risk-fill"
            style={{ width: `${Math.min(100, analysis.riskScore * 100)}%`, background: color }}
          />
        </div>
        <div className="spread mono-xs faint">
          <span>0.00</span>
          <span>0.35 MED</span>
          <span>0.60 HIGH</span>
          <span>0.82 CRIT</span>
          <span>1.00</span>
        </div>
      </div>

      {analysis.mode === 'BASELINE' && (
        <div className="notice">
          INSUFFICIENT HISTORICAL DATA — BASELINE ANALYSIS. Deterministic rules only; the
          Isolation Forest activates once enough artifacts are registered.
        </div>
      )}

      {analysis.anomalies.length > 0 ? (
        <div className="stack-sm">
          <div className="chart-title">DETECTED SIGNALS ({analysis.anomalies.length})</div>
          <div className="check-list">
            {analysis.anomalies.map((a) => (
              <div key={a.code}>
                <span
                  className="ck"
                  style={{ color: RISK_COLOR[a.severity] ?? 'var(--warn)' }}
                >
                  ▲
                </span>
                <span className="mono-xs" style={{ minWidth: 168 }}>{a.code}</span>
                <span style={{ fontSize: 13 }}>{a.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="notice good">No anomaly signals triggered for this artifact's registered history.</div>
      )}

      {analysis.explanation.length > 0 && (
        <div className="stack-sm">
          <div className="chart-title">ANALYSIS NOTES</div>
          {analysis.explanation.map((line, i) => (
            <p key={i} style={{ fontSize: 13.5, color: 'var(--ink-dim)' }}>
              {line}
            </p>
          ))}
        </div>
      )}

      <p className="mono-xs faint">
        AI analysis flags statistical anomalies for investigation. It does not — and cannot —
        prove an artifact malicious or safe. Integrity itself is decided by the blockchain hash
        commitment.
      </p>
    </div>
  );
}
