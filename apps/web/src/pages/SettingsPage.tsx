import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { VerificationResult } from '@proofchain/types';
import { api, ApiRequestError } from '../lib/api';
import { KV, Panel, Spinner, Tag, Hash } from '../components/ui';
import { VerifyResultPanel } from '../components/VerifyResult';
import { useSession } from './AppLayout';

export function SettingsPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const { data: net } = useQuery({ queryKey: ['network'], queryFn: api.networkConfig });
  const { data: demo, refetch } = useQuery({ queryKey: ['demo-status'], queryFn: api.demoStatus, refetchInterval: 8000 });

  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [demoResults, setDemoResults] = useState<{ intact: VerificationResult; tamperTarget: VerificationResult } | null>(null);

  const isAdmin = session.user?.role === 'ADMIN';

  const runAction = async (name: string, fn: () => Promise<string[] | void>) => {
    setBusy(name);
    setError(null);
    try {
      const lines = await fn();
      if (lines) setLog(lines);
      await refetch();
      void queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">SETTINGS / DEMO CONTROL</div>
        <h1>Registry operations</h1>
      </div>

      <div className="grid-2">
        <div className="stack">
          <Panel title="DEMO MODE">
            <div className="stack">
              <p style={{ fontSize: 13.5, color: 'var(--ink-dim)' }}>
                Demo actions run the real pipeline: files are generated and hashed, transactions
                are signed by the local dev account and mined on the Hardhat chain, and the
                integrity violation genuinely rewrites stored bytes so verification fails against
                the on-chain commitment.
              </p>
              <div className="row">
                <Tag tone={demo?.loaded ? 'ok' : ''}>{demo?.loaded ? 'DEMO LOADED' : 'NOT LOADED'}</Tag>
                <Tag tone={demo?.tampered ? 'bad' : ''}>{demo?.tampered ? 'TAMPERED STATE' : 'STORAGE INTACT'}</Tag>
                <span className="mono-xs dim">{demo?.artifactCount ?? 0} artifacts indexed</span>
              </div>
              {!session.user && (
                <div className="notice">
                  Demo controls require the ADMIN role — <Link className="accent" to="/login">sign in</Link> as
                  admin@proofchain.local (password proofchain-demo).
                </div>
              )}
              {session.user && !isAdmin && (
                <div className="notice err">Your role ({session.user.role}) cannot drive demo state. Sign in as ADMIN.</div>
              )}
              <div className="row">
                <button className="btn primary" disabled={!isAdmin || busy != null || demo?.loaded} onClick={() => void runAction('load', async () => (await api.demoLoad()).log)}>
                  {busy === 'load' ? 'REGISTERING ON-CHAIN…' : 'LOAD DEMO DATA'}
                </button>
                <button className="btn" disabled={!isAdmin || busy != null || !demo?.loaded} onClick={() => void runAction('verify', async () => { setDemoResults(await api.demoRunVerification()); })}>
                  {busy === 'verify' ? 'VERIFYING…' : 'RUN VERIFICATION DEMO'}
                </button>
                <button className="btn danger" disabled={!isAdmin || busy != null || !demo?.loaded} onClick={() => void runAction('tamper', async () => { const r = await api.demoTamper(); setLog([r.note]); })}>
                  {busy === 'tamper' ? 'TAMPERING…' : 'SIMULATE INTEGRITY VIOLATION'}
                </button>
                <button
                  className="btn"
                  disabled={!isAdmin || busy != null}
                  onClick={() => {
                    if (window.confirm('Reset demo: deploys a FRESH registry contract and clears the database index. Continue?')) {
                      void runAction('reset', async () => { const r = await api.demoReset(); setDemoResults(null); return [r.note, `New contract: ${r.newContractAddress}`]; });
                    }
                  }}
                >
                  {busy === 'reset' ? 'RESETTING…' : 'RESET DEMO'}
                </button>
              </div>
              {busy === 'load' && <Spinner label="SIGNING + MINING ~14 TRANSACTIONS ON THE LOCAL CHAIN" />}
              {error && <div className="notice err">{error}</div>}
              {log.length > 0 && (
                <div className="panel" style={{ background: 'var(--bg0)' }}>
                  <div className="panel-body" style={{ padding: 14 }}>
                    {log.map((line, i) => (
                      <div key={i} className="mono-xs dim" style={{ padding: '3px 0' }}>
                        <span className="accent">›</span> {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="SESSION">
            <KV
              rows={[
                ['USER', session.user ? `${session.user.displayName} (${session.user.email})` : '— not signed in —'],
                ['APPLICATION ROLE', session.user?.role ?? '—'],
                ['ROLE MODEL', <span key="r" className="mono-xs dim">ADMIN · RESEARCHER · DEVELOPER · AUDITOR · VIEWER — application-level authorization only. On-chain ownership is enforced by the contract, per wallet address.</span>],
              ]}
            />
          </Panel>
        </div>

        <div className="stack">
          <Panel title="ENVIRONMENT">
            <KV
              rows={[
                ['NETWORK', <span key="n" className="mono">{net?.network} (chainId {net?.chainId})</span>],
                ['RPC', <span key="r" className="mono-xs">{net?.rpcUrl}</span>],
                ['REGISTRY', net?.contractAddress ? <Hash key="c" value={net.contractAddress} head={12} tail={8} /> : '—'],
                ['STORAGE MODE', <span key="s" className="mono-xs">{net?.storageMode === 'pinata' ? 'IPFS (Pinata)' : 'LOCAL DEVELOPMENT STORAGE'}</span>],
                ['AI SERVICE', <Tag key="a" tone={net?.aiServiceUp ? 'ok' : ''}>{net?.aiServiceUp ? 'ONLINE' : 'OFFLINE'}</Tag>],
                ['SERVER SIGNER', net?.serverSignerAddress ? <Hash key="ss" value={net.serverSignerAddress} head={10} tail={6} /> : 'disabled'],
              ]}
            />
            <p className="mono-xs faint" style={{ marginTop: 12 }}>
              Configuration lives in the repo-root .env (see .env.example). Switching IPFS_MODE to
              pinata with a PINATA_JWT moves storage to real IPFS with zero code changes.
            </p>
          </Panel>
        </div>
      </div>

      {demoResults && (
        <div className="grid-2">
          <VerifyResultPanel result={demoResults.intact} />
          <VerifyResultPanel result={demoResults.tamperTarget} />
        </div>
      )}
    </div>
  );
}
