import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { EVENT_TONE, formatDate, shortHex } from '../lib/format';
import { BlockStrip, ColumnChart, RowBars } from '../components/charts';
import { EmptyState, ErrorState, Panel, Spinner, Tag } from '../components/ui';

const day = (iso: string) => iso.slice(5).replace('-', '/');

export function Overview() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboardStats,
    refetchInterval: 8_000,
  });

  if (isLoading) {
    return (
      <div className="page">
        <Spinner label="LOADING REGISTRY STATE" />
      </div>
    );
  }
  if (error || !stats) {
    return (
      <div className="page">
        <ErrorState title="REGISTRY UNREACHABLE">
          The API did not respond. Start the backend (`npm run dev` from the repo root) and reload.
        </ErrorState>
      </div>
    );
  }

  const empty = stats.totalArtifacts === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">REGISTRY OVERVIEW</div>
        <h1>Provenance console</h1>
      </div>

      <div className="stat-strip">
        <div className="stat-cell">
          <span className="label">TOTAL ARTIFACTS</span>
          <span className="value">{stats.totalArtifacts}</span>
          <span className="meta">
            {stats.byType.DATASET} DS · {stats.byType.MODEL} ML · {stats.byType.SOFTWARE} SW
          </span>
        </div>
        <div className="stat-cell">
          <span className="label">VERIFIED ARTIFACTS</span>
          <span className="value ok">{stats.verifiedArtifacts}</span>
          <span className="meta">distinct artifacts with a passing check</span>
        </div>
        <div className="stat-cell">
          <span className="label">INTEGRITY VIOLATIONS</span>
          <span className="value" style={{ color: stats.integrityViolations > 0 ? 'var(--bad)' : 'var(--ink)' }}>
            {stats.integrityViolations}
          </span>
          <span className="meta">failed verification attempts</span>
        </div>
        <div className="stat-cell">
          <span className="label">CHAIN TRANSACTIONS</span>
          <span className="value">{stats.blockchainTransactions}</span>
          <span className="meta">indexed registry operations</span>
        </div>
        <div className="stat-cell">
          <span className="label">HIGH-RISK ARTIFACTS</span>
          <span className="value" style={{ color: stats.highRiskArtifacts > 0 ? 'var(--warn)' : 'var(--ink)' }}>
            {stats.highRiskArtifacts}
          </span>
          <span className="meta">AI risk HIGH or CRITICAL</span>
        </div>
      </div>

      {empty ? (
        <Panel>
          <EmptyState
            title="NO ARTIFACTS REGISTERED"
            action={
              <div className="row">
                <Link to="/app/register" className="btn primary">REGISTER ARTIFACT</Link>
                <Link to="/app/settings" className="btn">LOAD DEMO DATA</Link>
              </div>
            }
          >
            Register your first artifact to establish an immutable provenance record, or load the
            demo registry from Settings.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid-2">
            <Panel title="VERIFICATION ACTIVITY — 14 DAYS">
              <ColumnChart
                categories={stats.verificationActivity.map((v) => v.date)}
                formatCategory={day}
                series={[
                  { name: 'Passed', color: 'var(--chart-good)', values: stats.verificationActivity.map((v) => v.passed) },
                  { name: 'Failed', color: 'var(--chart-critical)', values: stats.verificationActivity.map((v) => v.failed) },
                ]}
                emptyLabel="NO VERIFICATIONS IN THIS WINDOW"
              />
            </Panel>
            <Panel title="REGISTRATION ACTIVITY — 14 DAYS">
              <ColumnChart
                categories={stats.versionActivity.map((v) => v.date)}
                formatCategory={day}
                series={[
                  { name: 'New artifacts', color: 'var(--chart-1)', values: stats.versionActivity.map((v) => v.registered) },
                  { name: 'New versions', color: 'var(--chart-2)', values: stats.versionActivity.map((v) => v.versions) },
                ]}
                emptyLabel="NO REGISTRATIONS IN THIS WINDOW"
              />
            </Panel>
          </div>

          <div className="grid-3">
            <Panel title="ARTIFACT TYPES">
              <RowBars
                rows={[
                  { label: 'AI DATASETS', value: stats.byType.DATASET, color: 'var(--chart-1)' },
                  { label: 'ML MODELS', value: stats.byType.MODEL, color: 'var(--chart-1)' },
                  { label: 'SOFTWARE RELEASES', value: stats.byType.SOFTWARE, color: 'var(--chart-1)' },
                ]}
              />
            </Panel>
            <Panel title="RISK DISTRIBUTION (LATEST ANALYSES)">
              <RowBars
                rows={[
                  { label: 'LOW', value: stats.riskDistribution.LOW, color: 'var(--chart-good)' },
                  { label: 'MEDIUM', value: stats.riskDistribution.MEDIUM, color: 'var(--chart-warning)' },
                  { label: 'HIGH', value: stats.riskDistribution.HIGH, color: 'var(--chart-serious)' },
                  { label: 'CRITICAL', value: stats.riskDistribution.CRITICAL, color: 'var(--chart-critical)' },
                ]}
                emptyLabel="NO AI ANALYSES RECORDED YET"
              />
            </Panel>
            <Panel title="CHAIN ACTIVITY — RECENT BLOCKS">
              <BlockStrip blocks={stats.blockActivity} />
            </Panel>
          </div>

          <Panel title="RECENT PROVENANCE EVENTS" pad={false}>
            {stats.recentEvents.length === 0 ? (
              <EmptyState title="NO EVENTS RECORDED" />
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>EVENT</th>
                    <th>ARTIFACT</th>
                    <th>TX</th>
                    <th>BLOCK</th>
                    <th>WHEN</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentEvents.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Tag tone={EVENT_TONE[e.type] ?? ''} dot={false}>{e.type}</Tag>
                      </td>
                      <td>
                        {e.artifactChainId ? (
                          <Link className="accent" to={`/app/artifacts/${e.artifactChainId}`}>
                            {(e as { artifactName?: string | null }).artifactName ?? `#${e.artifactChainId}`}
                          </Link>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="mono-xs dim">{e.txHash ? shortHex(e.txHash, 10, 6) : '—'}</td>
                      <td className="mono-xs dim">{e.blockNumber ? `#${e.blockNumber}` : '—'}</td>
                      <td className="mono-xs faint">{formatDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
