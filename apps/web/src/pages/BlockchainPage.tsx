import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { EVENT_TONE, formatDate, shortHex } from '../lib/format';
import { EmptyState, ErrorState, Hash, KV, Panel, Spinner, Tag } from '../components/ui';

export function BlockchainPage() {
  const [txPage, setTxPage] = useState(1);
  const { data: net } = useQuery({ queryKey: ['network'], queryFn: api.networkConfig, refetchInterval: 8000 });
  const { data: blocks, isLoading: blocksLoading } = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.blocks(12),
    refetchInterval: 6000,
  });
  const { data: txs } = useQuery({
    queryKey: ['txs', txPage],
    queryFn: () => api.transactions(txPage),
    placeholderData: keepPreviousData,
    refetchInterval: 8000,
  });
  const { data: events } = useQuery({
    queryKey: ['chain-events'],
    queryFn: () => api.chainEvents(40),
    refetchInterval: 8000,
  });

  const txPages = txs ? Math.max(1, Math.ceil(txs.total / txs.pageSize)) : 1;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">BLOCKCHAIN EXPLORER</div>
        <h1>Registry chain state</h1>
      </div>

      <Panel title="NETWORK CONFIGURATION">
        <KV
          rows={[
            ['NETWORK', <span key="n" className="mono">{net?.network ?? '—'} {net?.chainUp ? '' : '(NODE DOWN)'}</span>],
            ['CHAIN ID', <span key="c" className="mono">{net?.chainId ?? '—'}</span>],
            ['RPC ENDPOINT', <span key="r" className="mono">{net?.rpcUrl ?? '—'}</span>],
            ['REGISTRY CONTRACT', net?.contractAddress ? <Hash key="a" value={net.contractAddress} head={14} tail={10} /> : <span key="a" className="faint mono">not deployed</span>],
            ['CERTIFICATE CONTRACT', net?.certificateAddress ? <Hash key="ce" value={net.certificateAddress} head={14} tail={10} /> : <span key="ce" className="faint mono">—</span>],
            ['LATEST BLOCK', <span key="b" className="mono">#{net?.latestBlock ?? '—'}</span>],
            ['SERVER SIGNER', net?.serverSignerAddress ? <Hash key="s" value={net.serverSignerAddress} head={12} tail={8} /> : <span key="s" className="faint mono">disabled</span>],
          ]}
        />
        <p className="mono-xs faint" style={{ marginTop: 12 }}>
          Default network is the local Hardhat chain. Point RPC_URL / CHAIN_ID / NETWORK_NAME at
          Sepolia (plus a funded PRIVATE_KEY) to run against the public testnet — same contracts,
          same indexer.
        </p>
      </Panel>

      {!net?.chainUp ? (
        <Panel>
          <ErrorState title="BLOCKCHAIN NODE UNREACHABLE">
            Start the local chain with `npm run chain`, deploy with `npm run deploy`, and this
            explorer fills with real blocks.
          </ErrorState>
        </Panel>
      ) : (
        <>
          <Panel title="LATEST BLOCKS" pad={false}>
            {blocksLoading || !blocks ? (
              <div className="panel-body"><Spinner label="READING BLOCKS" /></div>
            ) : blocks.blocks.length === 0 ? (
              <EmptyState title="NO BLOCKS OBSERVED" />
            ) : (
              <table className="ledger">
                <thead>
                  <tr><th>BLOCK</th><th>HASH</th><th>TXS</th><th>GAS USED</th><th>TIMESTAMP</th></tr>
                </thead>
                <tbody>
                  {blocks.blocks.map((b) => (
                    <tr key={b.number}>
                      <td className="mono">#{b.number}</td>
                      <td className="mono-xs dim">{shortHex(b.hash, 16, 10)}</td>
                      <td className="mono-xs">{b.txCount}</td>
                      <td className="mono-xs dim">{b.gasUsed}</td>
                      <td className="mono-xs faint">{formatDate(b.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <div className="grid-2">
            <Panel title="CONTRACT TRANSACTIONS" pad={false}>
              {!txs || txs.items.length === 0 ? (
                <EmptyState title="NO TRANSACTIONS INDEXED">Registry operations will appear here as they confirm.</EmptyState>
              ) : (
                <>
                  <table className="ledger">
                    <thead>
                      <tr><th>TX</th><th>METHOD</th><th>BLOCK</th><th>ARTIFACT</th><th>GAS</th></tr>
                    </thead>
                    <tbody>
                      {txs.items.map((t) => (
                        <tr key={t.txHash}>
                          <td className="mono-xs">{shortHex(t.txHash, 12, 8)}</td>
                          <td className="mono-xs accent">{t.method}</td>
                          <td className="mono-xs dim">#{t.blockNumber}</td>
                          <td className="mono-xs">
                            {t.artifactChainId ? (
                              <Link className="accent" to={`/app/artifacts/${t.artifactChainId}`}>#{t.artifactChainId}</Link>
                            ) : '—'}
                          </td>
                          <td className="mono-xs dim">{t.gasUsed ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {txPages > 1 && (
                    <div className="spread" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
                      <span className="mono-xs dim">page {txs.page}/{txPages}</span>
                      <div className="row">
                        <button className="btn sm" disabled={txPage <= 1} onClick={() => setTxPage((p) => p - 1)}>←</button>
                        <button className="btn sm" disabled={txPage >= txPages} onClick={() => setTxPage((p) => p + 1)}>→</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Panel>

            <Panel title="CONTRACT EVENT TIMELINE" pad={false}>
              {!events || events.items.length === 0 ? (
                <EmptyState title="NO EVENTS EMITTED">ArtifactRegistered / VersionCreated / OwnershipTransferred / Revoked events land here.</EmptyState>
              ) : (
                <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                  <table className="ledger">
                    <tbody>
                      {events.items.map((e) => (
                        <tr key={e.id}>
                          <td className="mono-xs dim">#{e.blockNumber ?? '—'}</td>
                          <td><Tag tone={EVENT_TONE[e.type] ?? ''} dot={false}>{e.type}</Tag></td>
                          <td className="mono-xs">
                            {e.artifactChainId ? (
                              <Link className="accent" to={`/app/artifacts/${e.artifactChainId}`}>
                                {e.artifactLabel ?? `#${e.artifactChainId}`}
                              </Link>
                            ) : '—'}
                          </td>
                          <td className="mono-xs faint">{shortHex(e.txHash ?? '', 10, 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
