import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VerificationResult } from '@proofchain/types';
import { api, ApiRequestError } from '../lib/api';
import { FileDrop, type FileDropResult } from '../components/FileDrop';
import { VerifyResultPanel } from '../components/VerifyResult';
import { EmptyState, Panel, Spinner, Tag } from '../components/ui';
import { formatDate, shortHex } from '../lib/format';

export function VerifyPage() {
  const [dropped, setDropped] = useState<FileDropResult | null>(null);
  const [target, setTarget] = useState<string>('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: artifacts } = useQuery({
    queryKey: ['artifacts', 'all-for-verify'],
    queryFn: () => api.artifacts({ page: 1, pageSize: 100 }),
  });
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ['verify-history'],
    queryFn: api.verifyHistory,
  });

  const run = async () => {
    if (!dropped) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      for (const f of dropped.files) form.append('files', f.file, f.file.name);
      form.append('paths', JSON.stringify(dropped.files.map((f) => f.path)));
      if (target) form.append('targetChainId', target);
      const res = await api.verify(form);
      setResult(res);
      void refetchHistory();
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">INTEGRITY VERIFICATION</div>
        <h1>Verify against the chain</h1>
        <p className="sub">
          The uploaded bytes are re-fingerprinted and compared with the commitment stored in the
          registry contract. The database only enriches the report — the verdict comes from the
          blockchain.
        </p>
      </div>

      <div className="grid-2">
        <div className="stack">
          <FileDrop onReady={setDropped} onClear={() => { setDropped(null); setResult(null); }} />
          <Panel title="OPTIONAL — VERIFY AGAINST A SPECIFIC ARTIFACT">
            <div className="stack-sm">
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: '100%', background: 'var(--bg0)', border: '1px solid var(--line2)', borderRadius: 2, color: 'var(--ink)', padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                <option value="">AUTO — match by fingerprint, then by manifest similarity</option>
                {artifacts?.items.map((a) => (
                  <option key={a.chainId} value={a.chainId}>
                    #{a.chainId} — {a.name} {a.version}
                  </option>
                ))}
              </select>
              <p className="mono-xs faint">
                With a target selected, a non-matching fingerprint is reported as an integrity
                mismatch against that artifact, including a per-file manifest diff.
              </p>
            </div>
          </Panel>
          <button className="btn primary" style={{ padding: '16px 24px' }} disabled={!dropped || busy} onClick={() => void run()}>
            {busy ? 'QUERYING BLOCKCHAIN…' : 'VERIFY INTEGRITY'}
          </button>
          {busy && <Spinner label="RECOMPUTING FINGERPRINT AND QUERYING THE REGISTRY" />}
          {error && <div className="notice err">{error}</div>}
        </div>

        <div className="stack">
          {result ? (
            <VerifyResultPanel result={result} />
          ) : (
            <Panel>
              <EmptyState title="AWAITING ARTIFACT">
                Drop the exact files you received. A single flipped byte anywhere in the set
                changes the fingerprint and breaks the match.
              </EmptyState>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="VERIFICATION LOG" pad={false}>
        {!history || history.items.length === 0 ? (
          <EmptyState title="NO VERIFICATIONS RECORDED">
            Every verification attempt — matched or not — is recorded here with its digest.
          </EmptyState>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>RESULT</th>
                <th>SUBJECT</th>
                <th>MATCHED ARTIFACT</th>
                <th>SUPPLIED DIGEST</th>
                <th>METHOD</th>
                <th>WHEN</th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((h) => (
                <tr key={h.id}>
                  <td>{h.matched ? <Tag tone="ok">VERIFIED</Tag> : <Tag tone="bad">MISMATCH</Tag>}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.fileName}</td>
                  <td className="mono-xs dim">{h.artifactLabel ?? '—'}</td>
                  <td className="mono-xs dim">{shortHex(h.suppliedHash, 12, 8)}</td>
                  <td className="mono-xs faint">{h.method}</td>
                  <td className="mono-xs faint">{formatDate(h.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
