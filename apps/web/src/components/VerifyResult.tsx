import type { VerificationResult } from '@proofchain/types';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';
import { Hash, KV } from './ui';

export function VerifyResultPanel({ result }: { result: VerificationResult }) {
  const pass = result.matched;
  const known = Boolean(result.registeredHash);

  return (
    <div className={`verdict reveal ${pass ? 'pass' : 'fail'}`} data-testid="verdict">
      <div className="verdict-head">
        <div className="mark">{pass ? '✓' : '✕'}</div>
        <div>
          <div className="verdict-title">
            {pass ? 'Integrity verified' : known ? 'Integrity mismatch' : 'Not registered'}
          </div>
          <div className="mono-xs dim">
            {result.method === 'MERKLE' ? 'MERKLE ROOT' : 'SHA-256'} · {result.fileCount} file
            {result.fileCount === 1 ? '' : 's'} · checked {formatDate(result.checkedAt)}
          </div>
        </div>
      </div>

      <div className="panel-body stack">
        <div className="check-list">
          <div>
            <span className={`ck ${pass ? 'ok' : 'bad'}`}>{pass ? '✓' : '✕'}</span>
            <span>
              {pass
                ? 'Fingerprint matches the on-chain commitment'
                : known
                  ? 'Fingerprint does NOT match the on-chain commitment'
                  : 'No on-chain commitment exists for this fingerprint'}
            </span>
          </div>
          {result.artifact && (
            <>
              <div>
                <span className="ck ok">✓</span>
                <span>
                  Registered artifact identified:{' '}
                  <Link className="accent" to={`/app/artifacts/${result.artifact.chainId}`}>
                    {result.artifact.name} {result.artifact.version} (#{result.artifact.chainId})
                  </Link>
                </span>
              </div>
              <div>
                <span className="ck ok">✓</span>
                <span>
                  Owner on-chain: <span className="mono">{result.artifact.ownerAddress.slice(0, 10)}…</span>
                </span>
              </div>
              <div>
                <span className={`ck ${result.artifact.active ? 'ok' : 'warn'}`}>
                  {result.artifact.active ? '✓' : '!'}
                </span>
                <span>{result.artifact.active ? 'Artifact is active (not revoked)' : 'Artifact was REVOKED by its owner'}</span>
              </div>
              <div>
                <span className="ck ok">✓</span>
                <span>Provenance record available</span>
              </div>
            </>
          )}
        </div>

        <KV
          rows={[
            ['CURRENT HASH', <Hash key="c" value={result.suppliedHash} head={20} tail={12} />],
            [
              'REGISTERED HASH',
              result.registeredHash ? (
                <Hash value={result.registeredHash} head={20} tail={12} />
              ) : (
                <span className="mono faint">— none on-chain —</span>
              ),
            ],
            ...(result.chain
              ? ([
                  ['CONTRACT', <Hash key="ct" value={result.chain.contractAddress} />],
                  ['NETWORK', <span key="n" className="mono">{result.chain.network}</span>],
                  ...(result.chain.txHash
                    ? ([['REGISTRATION TX', <Hash key="tx" value={result.chain.txHash} />]] as [string, React.ReactNode][])
                    : []),
                  ...(result.chain.blockNumber
                    ? ([['BLOCK', <span key="b" className="mono">#{result.chain.blockNumber}</span>]] as [string, React.ReactNode][])
                    : []),
                  ...(result.chain.timestamp
                    ? ([['REGISTERED AT', <span key="t" className="mono-xs">{formatDate(result.chain.timestamp)}</span>]] as [string, React.ReactNode][])
                    : []),
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />

        {result.manifestDiff && !pass && (
          <div className="stack-sm">
            <div className="chart-title">MANIFEST DIFF VS REGISTERED ARTIFACT</div>
            <div className="check-list">
              {result.manifestDiff.modified.map((p) => (
                <div key={`m-${p}`}>
                  <span className="ck bad">Δ</span>
                  <span className="mono">{p}</span>
                  <span className="mono-xs faint">MODIFIED</span>
                </div>
              ))}
              {result.manifestDiff.missing.map((p) => (
                <div key={`x-${p}`}>
                  <span className="ck bad">−</span>
                  <span className="mono">{p}</span>
                  <span className="mono-xs faint">MISSING</span>
                </div>
              ))}
              {result.manifestDiff.added.map((p) => (
                <div key={`a-${p}`}>
                  <span className="ck warn">+</span>
                  <span className="mono">{p}</span>
                  <span className="mono-xs faint">ADDED</span>
                </div>
              ))}
              {result.manifestDiff.modified.length + result.manifestDiff.missing.length + result.manifestDiff.added.length === 0 && (
                <div>
                  <span className="ck dim">·</span>
                  <span className="dim">Same file set — contents differ at the byte level.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {!known && (
          <div className="notice">
            This fingerprint has no on-chain commitment and does not resemble any registered
            manifest. If this artifact should be trusted, register it to establish provenance.
          </div>
        )}
      </div>
    </div>
  );
}
