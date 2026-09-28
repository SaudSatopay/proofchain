import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ProvenanceFlow } from '../components/ProvenanceFlow';
import { EmptyState, Panel, Spinner } from '../components/ui';

export function ProvenancePage() {
  const { data: artifacts, isLoading } = useQuery({
    queryKey: ['artifacts', 'all-for-provenance'],
    queryFn: () => api.artifacts({ page: 1, pageSize: 100 }),
  });

  // One entry per lineage family (rootChainId).
  const families = useMemo(() => {
    const byRoot = new Map<number, { rootChainId: number; label: string; count: number }>();
    for (const a of artifacts?.items ?? []) {
      const existing = byRoot.get(a.rootChainId);
      if (existing) {
        existing.count++;
      } else {
        byRoot.set(a.rootChainId, { rootChainId: a.rootChainId, label: `${a.name}`, count: 1 });
      }
    }
    // Label with the ROOT artifact's name when we have it.
    for (const a of artifacts?.items ?? []) {
      if (a.chainId === a.rootChainId) {
        const fam = byRoot.get(a.rootChainId);
        if (fam) fam.label = `${a.name}`;
      }
    }
    return [...byRoot.values()].sort((x, y) => x.rootChainId - y.rootChainId);
  }, [artifacts]);

  const [selected, setSelected] = useState<number | null>(null);
  const active = selected ?? families[0]?.rootChainId ?? null;

  const { data: graph, isLoading: graphLoading } = useQuery({
    queryKey: ['provenance', active],
    queryFn: () => api.provenance(active!),
    enabled: active != null,
  });

  if (isLoading) return <div className="page"><Spinner label="LOADING FAMILIES" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">PROVENANCE GRAPH</div>
        <h1>Lineage investigation</h1>
        <p className="sub">
          Every edge is backed by an on-chain parent pointer. Version succession runs in orange;
          derivations (a model trained on a dataset, a release built from a model) are dashed blue.
        </p>
      </div>

      {families.length === 0 ? (
        <Panel>
          <EmptyState
            title="NO LINEAGES TO DISPLAY"
            action={<Link to="/app/register" className="btn primary">REGISTER ARTIFACT</Link>}
          >
            Register artifacts (or load the demo data in Settings) to build provenance trees.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="row">
            {families.map((f) => (
              <button
                key={f.rootChainId}
                className="btn sm"
                style={
                  active === f.rootChainId
                    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#0c0d0f' }
                    : undefined
                }
                onClick={() => setSelected(f.rootChainId)}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
          {graphLoading || !graph ? (
            <Spinner label="BUILDING GRAPH FROM CHAIN INDEX" />
          ) : (
            <ProvenanceFlow graph={graph} height={560} />
          )}
        </>
      )}
    </div>
  );
}
