import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBytes, shortHex, timeAgo } from '../lib/format';
import { EmptyState, Panel, RiskTag, Spinner, Tag, TypeTag } from '../components/ui';

const TYPES = ['', 'DATASET', 'MODEL', 'SOFTWARE'] as const;

export function ArtifactsList() {
  const [type, setType] = useState<string>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['artifacts', type, search, page],
    queryFn: () => api.artifacts({ type: type || undefined, q: search || undefined, page, pageSize: 15 }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <div className="eyebrow">REGISTERED ARTIFACTS</div>
          <h1>Artifact ledger</h1>
        </div>
        <Link to="/app/register" className="btn primary">REGISTER ARTIFACT</Link>
      </div>

      <div className="row">
        <div className="row" style={{ gap: 0, border: '1px solid var(--line2)', borderRadius: 2, overflow: 'hidden' }}>
          {TYPES.map((t) => (
            <button
              key={t || 'ALL'}
              className="btn sm ghost"
              style={{
                border: 'none',
                borderRadius: 0,
                background: type === t ? 'var(--accent)' : 'transparent',
                color: type === t ? '#0c0d0f' : 'var(--ink-dim)',
              }}
              onClick={() => {
                setType(t);
                setPage(1);
              }}
            >
              {t === '' ? 'ALL' : t}
            </button>
          ))}
        </div>
        <form
          className="row"
          style={{ flex: 1, minWidth: 220 }}
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(1);
          }}
        >
          <input
            className="mono-input"
            style={{
              flex: 1,
              background: 'var(--bg1)',
              border: '1px solid var(--line2)',
              borderRadius: 2,
              padding: '8px 12px',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
            placeholder="search name / creator / hash…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn sm" type="submit">SEARCH</button>
        </form>
      </div>

      <Panel pad={false}>
        {isLoading ? (
          <div className="panel-body"><Spinner label="LOADING LEDGER" /></div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="NO ARTIFACTS MATCH"
            action={<Link to="/app/register" className="btn">REGISTER ARTIFACT</Link>}
          >
            {search || type
              ? 'No registered artifact matches this filter.'
              : 'Register your first artifact to establish an immutable provenance record.'}
          </EmptyState>
        ) : (
          <>
            <table className="ledger">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ARTIFACT</th>
                  <th>TYPE</th>
                  <th>FINGERPRINT</th>
                  <th>SIZE</th>
                  <th>OWNER</th>
                  <th>RISK</th>
                  <th>STATE</th>
                  <th>REGISTERED</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.chainId} className="click" onClick={() => navigate(`/app/artifacts/${a.chainId}`)}>
                    <td className="mono-xs dim">#{a.chainId}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div className="mono-xs dim">{a.version}{a.creator ? ` · ${a.creator}` : ''}</div>
                    </td>
                    <td><TypeTag type={a.artifactType} /></td>
                    <td className="mono-xs dim">{shortHex(a.artifactHash, 12, 8)}</td>
                    <td className="mono-xs dim">{formatBytes(a.sizeBytes)}{a.fileCount > 1 ? ` · ${a.fileCount}f` : ''}</td>
                    <td className="mono-xs dim">{shortHex(a.ownerAddress, 6, 4)}</td>
                    <td><RiskTag level={a.latestRisk?.riskLevel} score={a.latestRisk?.riskScore} /></td>
                    <td>{a.active ? <Tag tone="ok">ACTIVE</Tag> : <Tag tone="warn">REVOKED</Tag>}</td>
                    <td className="mono-xs faint">{timeAgo(a.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="spread" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
                <span className="mono-xs dim">
                  {data.total} artifacts · page {data.page}/{pages}
                </span>
                <div className="row">
                  <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← PREV</button>
                  <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>NEXT →</button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
