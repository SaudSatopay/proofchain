import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { VerificationResult } from '@proofchain/types';
import { api, ApiRequestError } from '../lib/api';
import { EVENT_TONE, formatBytes, formatDate, shortHex } from '../lib/format';
import { EmptyState, ErrorState, Hash, KV, Panel, RiskTag, Spinner, Tag, TypeTag } from '../components/ui';
import { ProvenanceFlow } from '../components/ProvenanceFlow';
import { RiskPanel } from '../components/RiskPanel';
import { VerifyResultPanel } from '../components/VerifyResult';
import { FileDrop, type FileDropResult } from '../components/FileDrop';
import { useSession } from './AppLayout';

const TABS = ['OVERVIEW', 'PROVENANCE', 'BLOCKCHAIN', 'VERSIONS', 'VERIFICATION', 'AI ANALYSIS'] as const;
type Tab = (typeof TABS)[number];

export function ArtifactDetail() {
  const { chainId: raw } = useParams();
  const chainId = Number(raw);
  const [tab, setTab] = useState<Tab>('OVERVIEW');
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['artifact', chainId],
    queryFn: () => api.artifactDetail(chainId),
    enabled: Number.isInteger(chainId) && chainId > 0,
  });
  const { data: graph } = useQuery({
    queryKey: ['provenance', chainId],
    queryFn: () => api.provenance(chainId),
    enabled: tab === 'PROVENANCE' && Number.isInteger(chainId),
  });

  const [storedResult, setStoredResult] = useState<VerificationResult | null>(null);
  const [uploadResult, setUploadResult] = useState<VerificationResult | null>(null);
  const [dropped, setDropped] = useState<FileDropResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState('');

  if (isLoading) return <div className="page"><Spinner label="READING CHAIN + INDEX" /></div>;
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState title="ARTIFACT NOT FOUND">
          Artifact #{raw} has no on-chain registration on this network.
        </ErrorState>
      </div>
    );
  }

  const a = data.artifact;
  const canWrite = session.user && ['ADMIN', 'RESEARCHER', 'DEVELOPER'].includes(session.user.role);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusyAction(label);
    setActionError(null);
    try {
      await fn();
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const verifyUpload = async () => {
    if (!dropped) return;
    setBusyAction('verify-upload');
    setActionError(null);
    try {
      const form = new FormData();
      for (const f of dropped.files) form.append('files', f.file, f.file.name);
      form.append('paths', JSON.stringify(dropped.files.map((f) => f.path)));
      const res = await request$(chainId, form);
      setUploadResult(res);
      await refetch();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="stack-sm">
          <div className="row">
            <TypeTag type={a.artifactType} />
            <span className="mono-xs dim">ARTIFACT #{a.chainId}</span>
            {a.active ? <Tag tone="ok">ACTIVE</Tag> : <Tag tone="warn">REVOKED</Tag>}
            <RiskTag level={data.analyses[0]?.riskLevel} score={data.analyses[0]?.riskScore} />
          </div>
          <h1 style={{ fontSize: 30 }}>
            {a.name} <span className="accent">{a.version}</span>
          </h1>
          <div className="mono-xs dim">{data.storageLabel} · {a.network} · registered {formatDate(a.registeredAt)}</div>
        </div>
        {canWrite && a.active && (
          <div className="row">
            <button className="btn sm" onClick={() => navigate(`/app/register?parent=${a.chainId}&asVersion=1&name=${encodeURIComponent(a.name)}&type=${a.artifactType}`)}>
              NEW VERSION
            </button>
            <button
              className="btn sm danger"
              disabled={busyAction != null}
              onClick={() => {
                if (window.confirm(`Revoke ${a.name} ${a.version} on-chain? The record remains, marked revoked forever.`)) {
                  void act('revoke', () => api.revoke(a.chainId));
                }
              }}
            >
              REVOKE
            </button>
          </div>
        )}
      </div>

      {actionError && <div className="notice err">{actionError}</div>}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'OVERVIEW' && (
        <div className="grid-2">
          <Panel title="IDENTITY">
            <KV
              rows={[
                ['NAME', a.name],
                ['VERSION', <span key="v" className="mono">{a.version}</span>],
                ['TYPE', a.artifactType],
                ['CREATOR', a.creator || '—'],
                ['DESCRIPTION', a.description || '—'],
                ...Object.entries(a.fields ?? {})
                  .filter(([, v]) => v)
                  .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toUpperCase(), String(v)] as [string, React.ReactNode]),
              ]}
            />
          </Panel>
          <div className="stack">
            <Panel title="CRYPTOGRAPHIC COMMITMENT">
              <KV
                rows={[
                  [a.merkleRoot ? 'MERKLE ROOT' : 'SHA-256', <Hash key="h" value={a.artifactHash} head={20} tail={12} />],
                  ['FILES', <span key="f" className="mono">{a.fileCount} · {formatBytes(a.sizeBytes)}</span>],
                  ['METADATA CID', <Hash key="c" value={a.metadataCid} head={16} tail={8} />],
                  ['STORAGE', <span key="s" className="mono-xs">{data.storageLabel}</span>],
                  ...(data.gatewayUrl
                    ? ([['GATEWAY', <a key="g" className="accent mono-xs" href={`${data.gatewayUrl}?json=1`} target="_blank" rel="noreferrer">open metadata ↗</a>]] as [string, React.ReactNode][])
                    : []),
                ]}
              />
            </Panel>
            <Panel title="OWNERSHIP">
              <div className="stack-sm">
                <KV
                  rows={[
                    ['OWNER', <Hash key="o" value={a.ownerAddress} head={12} tail={8} />],
                    ['PARENT', a.parentChainId ? <Link key="p" className="accent mono" to={`/app/artifacts/${a.parentChainId}`}>#{a.parentChainId}</Link> : <span key="p" className="faint">— root artifact —</span>],
                  ]}
                />
                {canWrite && a.active && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <input
                      className="mono-input"
                      style={{ flex: 1, background: 'var(--bg0)', border: '1px solid var(--line2)', borderRadius: 2, padding: '8px 10px', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      placeholder="0x… transfer ownership to"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                    />
                    <button
                      className="btn sm"
                      disabled={!/^0x[0-9a-fA-F]{40}$/.test(transferTo) || busyAction != null}
                      onClick={() => void act('transfer', () => api.transfer(a.chainId, transferTo).then(() => setTransferTo('')))}
                    >
                      {busyAction === 'transfer' ? '…' : 'TRANSFER'}
                    </button>
                  </div>
                )}
                <p className="mono-xs faint">
                  Transfers/revocations here use the server dev signer and succeed only if it owns
                  the artifact on-chain — the contract enforces ownership, not the app.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'PROVENANCE' && (
        <div className="stack">
          {graph ? <ProvenanceFlow graph={graph} /> : <Spinner label="BUILDING GRAPH" />}
          <p className="mono-xs faint">
            Solid orange edges = version succession · dashed blue edges = derivation (e.g. model
            trained on dataset). Click a node to open it.
          </p>
        </div>
      )}

      {tab === 'BLOCKCHAIN' && (
        <div className="stack">
          <Panel title="REGISTRATION COMMITMENT">
            <KV
              rows={[
                ['TRANSACTION', <Hash key="t" value={a.txHash} head={20} tail={12} />],
                ['BLOCK', <span key="b" className="mono">#{a.blockNumber}</span>],
                ['CONTRACT', <Hash key="c" value={a.contractAddress} head={14} tail={10} />],
                ['NETWORK', <span key="n" className="mono">{a.network} (chainId {31337})</span>],
                ['GAS USED', <span key="g" className="mono">{a.gasUsed ?? '—'}</span>],
                ['BLOCK TIMESTAMP', <span key="ts" className="mono-xs">{formatDate(a.registeredAt)}</span>],
              ]}
            />
          </Panel>
          <Panel title="ALL TRANSACTIONS FOR THIS ARTIFACT" pad={false}>
            {data.transactions.length === 0 ? (
              <EmptyState title="NO INDEXED TRANSACTIONS" />
            ) : (
              <table className="ledger">
                <thead>
                  <tr><th>TX HASH</th><th>METHOD</th><th>BLOCK</th><th>FROM</th><th>GAS</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr key={t.txHash}>
                      <td className="mono-xs">{shortHex(t.txHash, 14, 10)}</td>
                      <td className="mono-xs accent">{t.method ?? '—'}</td>
                      <td className="mono-xs dim">#{t.blockNumber}</td>
                      <td className="mono-xs dim">{shortHex(t.fromAddress, 8, 6)}</td>
                      <td className="mono-xs dim">{t.gasUsed ?? '—'}</td>
                      <td>{t.status === 'confirmed' ? <Tag tone="ok" dot={false}>CONFIRMED</Tag> : <Tag tone="bad" dot={false}>FAILED</Tag>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}

      {tab === 'VERSIONS' && (
        <Panel title={`LINEAGE — ${data.lineage.length} RECORD${data.lineage.length === 1 ? '' : 'S'}`} pad={false}>
          <table className="ledger">
            <thead>
              <tr><th>ID</th><th>VERSION</th><th>FINGERPRINT</th><th>SIZE</th><th>OWNER</th><th>REGISTERED</th><th></th></tr>
            </thead>
            <tbody>
              {data.lineage.map((v) => (
                <tr key={v.chainId} className="click" onClick={() => navigate(`/app/artifacts/${v.chainId}`)}>
                  <td className="mono-xs dim">#{v.chainId}</td>
                  <td className="mono">{v.version}{v.chainId === a.chainId && <span className="accent"> ← this</span>}</td>
                  <td className="mono-xs dim">{shortHex(v.artifactHash, 12, 8)}</td>
                  <td className="mono-xs dim">{formatBytes(v.sizeBytes)}</td>
                  <td className="mono-xs dim">{shortHex(v.ownerAddress, 6, 4)}</td>
                  <td className="mono-xs faint">{formatDate(v.registeredAt)}</td>
                  <td>{v.active ? '' : <Tag tone="warn" dot={false}>REVOKED</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.children.length > 0 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
              <span className="mono-xs faint">DERIVED / CHILD ARTIFACTS: </span>
              {data.children.map((c) => (
                <Link key={c.chainId} className="accent mono-xs" style={{ marginRight: 12 }} to={`/app/artifacts/${c.chainId}`}>
                  #{c.chainId} {c.name} {c.version}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'VERIFICATION' && (
        <div className="grid-2">
          <div className="stack">
            <Panel title="VERIFY THE STORED COPY">
              <div className="stack-sm">
                <p style={{ fontSize: 13.5, color: 'var(--ink-dim)' }}>
                  Reads every stored object back from the storage layer, recomputes the
                  fingerprint and compares it with the on-chain commitment — detects tampering
                  with stored bytes.
                </p>
                <button
                  className="btn"
                  disabled={busyAction != null}
                  onClick={() =>
                    void act('verify-stored', async () => {
                      const res = await api.verifyStored(a.chainId);
                      setStoredResult(res);
                    })
                  }
                >
                  {busyAction === 'verify-stored' ? 'VERIFYING…' : 'RUN STORED-COPY VERIFICATION'}
                </button>
              </div>
            </Panel>
            <Panel title="VERIFY AN UPLOADED COPY">
              <div className="stack-sm">
                <FileDrop compact onReady={setDropped} onClear={() => setDropped(null)} />
                <button className="btn" disabled={!dropped || busyAction != null} onClick={() => void verifyUpload()}>
                  {busyAction === 'verify-upload' ? 'VERIFYING…' : `VERIFY AGAINST #${a.chainId}`}
                </button>
              </div>
            </Panel>
            <Panel title="VERIFICATION LOG" pad={false}>
              {data.verifications.length === 0 ? (
                <EmptyState title="NO VERIFICATIONS FOR THIS ARTIFACT" />
              ) : (
                <table className="ledger">
                  <tbody>
                    {data.verifications.map((v) => (
                      <tr key={v.id}>
                        <td>{v.matched ? <Tag tone="ok" dot={false}>PASS</Tag> : <Tag tone="bad" dot={false}>FAIL</Tag>}</td>
                        <td className="mono-xs dim" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.fileName}</td>
                        <td className="mono-xs faint">{formatDate(v.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
          <div className="stack">
            {storedResult && <VerifyResultPanel result={storedResult} />}
            {uploadResult && <VerifyResultPanel result={uploadResult} />}
            {!storedResult && !uploadResult && (
              <Panel><EmptyState title="NO CHECK RUN YET">Run a stored-copy or upload verification to see the verdict here.</EmptyState></Panel>
            )}
          </div>
        </div>
      )}

      {tab === 'AI ANALYSIS' && (
        <div className="stack">
          <div className="row">
            <button
              className="btn primary"
              disabled={busyAction != null}
              onClick={() => void act('analyze', () => api.aiAnalyze(a.chainId))}
            >
              {busyAction === 'analyze' ? 'ANALYZING…' : 'RUN AI RISK ANALYSIS'}
            </button>
            <span className="mono-xs faint">Features come from this artifact's real registered history.</span>
          </div>
          {data.analyses.length > 0 ? (
            <Panel><RiskPanel analysis={data.analyses[0]} /></Panel>
          ) : (
            <Panel>
              <EmptyState title="NOT ANALYZED YET">
                Run the analysis to compute a risk assessment from version cadence, size drift,
                verification failures and ownership changes.
              </EmptyState>
            </Panel>
          )}
          {data.analyses.length > 1 && (
            <Panel title="PREVIOUS ANALYSES" pad={false}>
              <table className="ledger">
                <tbody>
                  {data.analyses.slice(1).map((an, i) => (
                    <tr key={i}>
                      <td><RiskTag level={an.riskLevel} score={an.riskScore} /></td>
                      <td className="mono-xs dim">{an.modelVersion} · {an.mode}</td>
                      <td className="mono-xs faint">{formatDate(an.analyzedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}

      {tab === 'OVERVIEW' && data.events.length > 0 && (
        <Panel title="EVENT TRAIL" pad={false}>
          <table className="ledger">
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td><Tag tone={EVENT_TONE[e.type] ?? ''} dot={false}>{e.type}</Tag></td>
                  <td className="mono-xs dim">{e.txHash ? shortHex(e.txHash, 12, 8) : '—'}</td>
                  <td className="mono-xs dim">{e.blockNumber ? `#${e.blockNumber}` : '—'}</td>
                  <td className="mono-xs faint">{formatDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

/** Verify uploaded files against this specific artifact. */
async function request$(chainId: number, form: FormData): Promise<VerificationResult> {
  const res = await fetch(`/api/artifacts/${chainId}/verify`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Verification failed');
  }
  return res.json();
}
