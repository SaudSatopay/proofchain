import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AiAnalysisResult } from '@proofchain/types';
import { api, ApiRequestError } from '../lib/api';
import { RiskPanel } from '../components/RiskPanel';
import { EmptyState, ErrorState, KV, Panel, Spinner } from '../components/ui';

export function AnalysisPage() {
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus, refetchInterval: 10_000 });
  const { data: artifacts } = useQuery({
    queryKey: ['artifacts', 'all-for-ai'],
    queryFn: () => api.artifacts({ page: 1, pageSize: 100 }),
  });

  const [selected, setSelected] = useState<string>('');
  const [result, setResult] = useState<AiAnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.aiAnalyze(Number(selected)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Analysis failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">AI RISK ANALYSIS</div>
        <h1>Anomaly detection</h1>
        <p className="sub">
          A scikit-learn Isolation Forest fitted on the registered population, combined with a
          deterministic rule baseline over each artifact's real history. It flags unusual
          behavior for investigation — it never claims proof of malice.
        </p>
      </div>

      {!aiStatus?.up && (
        <ErrorState title="AI SERVICE OFFLINE">
          The FastAPI analysis service is unreachable. Start it with `npm run ai` — everything
          else keeps working; analysis is honestly reported as unavailable rather than faked.
        </ErrorState>
      )}

      <div className="grid-2">
        <div className="stack">
          <Panel title="SELECT ARTIFACT">
            <div className="stack-sm">
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ width: '100%', background: 'var(--bg0)', border: '1px solid var(--line2)', borderRadius: 2, color: 'var(--ink)', padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13 }}
              >
                <option value="">— choose a registered artifact —</option>
                {artifacts?.items.map((a) => (
                  <option key={a.chainId} value={a.chainId}>
                    #{a.chainId} — {a.name} {a.version} ({a.artifactType})
                  </option>
                ))}
              </select>
              <button className="btn primary" disabled={!selected || busy || !aiStatus?.up} onClick={() => void run()}>
                {busy ? 'ANALYZING…' : 'RUN ANALYSIS'}
              </button>
              {error && <div className="notice err">{error}</div>}
            </div>
          </Panel>

          <Panel title="MODEL CARD">
            {aiStatus?.info ? (
              <KV
                rows={[
                  ['MODEL', <span key="m" className="mono-xs">{aiStatus.info.mlModel}</span>],
                  ['ML VERSION', <span key="v" className="mono-xs">{aiStatus.info.mlModelVersion}</span>],
                  ['BASELINE', <span key="b" className="mono-xs">{aiStatus.info.baselineVersion}</span>],
                  ['ML ACTIVATION', <span key="a" className="mono-xs">≥ {aiStatus.info.minSamplesForMl} registered artifacts</span>],
                  ['FEATURES', <span key="f" className="mono-xs dim">{aiStatus.info.features.join(' · ')}</span>],
                ]}
              />
            ) : (
              <EmptyState title="MODEL INFO UNAVAILABLE" />
            )}
          </Panel>
        </div>

        <div className="stack">
          {result ? (
            <Panel><RiskPanel analysis={result} /></Panel>
          ) : (
            <Panel>
              <EmptyState title="NO ANALYSIS DISPLAYED">
                {busy ? <Spinner label="EXTRACTING FEATURES + SCORING" /> : 'Select an artifact and run the analysis.'}
              </EmptyState>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
