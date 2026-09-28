import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sha256Hex } from '@proofchain/crypto';
import type { VerificationResult } from '@proofchain/types';
import { api } from '../lib/api';
import { FileDrop, type FileDropResult } from '../components/FileDrop';
import { VerifyResultPanel } from '../components/VerifyResult';
import { Hash, Tag } from '../components/ui';
import { EVENT_TONE, formatDate, shortHex } from '../lib/format';

const HERO_INPUT = 'PROOFCHAIN :: Trust the Origin. Verify the Integrity.';

const PIPELINE = [
  { num: '01', name: 'FILE', desc: 'Any artifact: a dataset directory, model weights, a package tarball.' },
  { num: '02', name: 'HASH', desc: 'SHA-256 over the raw bytes. One flipped bit produces an unrelated digest.' },
  { num: '03', name: 'MERKLE ROOT', desc: 'File digests become leaves; pairs hash upward to a single 32-byte root for the whole set.' },
  { num: '04', name: 'STORAGE / IPFS', desc: 'Files + canonical manifest go to content-addressed storage — local in dev, Pinata/IPFS when configured.' },
  { num: '05', name: 'SMART CONTRACT', desc: 'registerArtifact() commits the fingerprint, owner, lineage pointer and metadata CID.' },
  { num: '06', name: 'BLOCKCHAIN', desc: 'The commitment lands in a block. From here, nobody — including us — can rewrite it.' },
  { num: '07', name: 'VERIFICATION', desc: 'Anyone re-hashes their copy and asks the chain: is this exact fingerprint registered?' },
];

function useHeroHash() {
  const [digest, setDigest] = useState<string>('');
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(HERO_INPUT).then((d) => {
      if (cancelled) return;
      setDigest(d);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setShown(d.length);
        return;
      }
      timer.current = setInterval(() => {
        setShown((s) => {
          if (s >= d.length) {
            if (timer.current) clearInterval(timer.current);
            return s;
          }
          return s + 2;
        });
      }, 28);
    });
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  return { digest, shown };
}

export function Landing() {
  const { digest, shown } = useHeroHash();
  const { data: net } = useQuery({ queryKey: ['network'], queryFn: api.networkConfig, refetchInterval: 12_000, retry: 0 });
  const { data: stats } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboardStats, refetchInterval: 15_000, retry: 0 });
  const { data: events } = useQuery({ queryKey: ['chain-events-landing'], queryFn: () => api.chainEvents(8), refetchInterval: 12_000, retry: 0 });
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus, retry: 0 });

  const [dropped, setDropped] = useState<FileDropResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<VerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const apiUp = net != null;
  const revealed = useMemo(() => digest.slice(0, shown), [digest, shown]);

  const runVerify = async () => {
    if (!dropped) return;
    setVerifying(true);
    setVerifyError(null);
    setVerdict(null);
    try {
      const form = new FormData();
      for (const f of dropped.files) form.append('files', f.file, f.file.name);
      form.append('paths', JSON.stringify(dropped.files.map((f) => f.path)));
      setVerdict(await api.verify(form));
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="display" style={{ fontSize: 18, letterSpacing: '-0.02em' }}>
          PROOF<span className="accent">CHAIN</span>
        </span>
        <div className="row">
          <a className="mono-xs dim" href="#how">PIPELINE</a>
          <a className="mono-xs dim" href="#verify">VERIFY</a>
          <a className="mono-xs dim" href="#analysis">AI</a>
          <Link to="/app" className="btn sm primary">OPEN CONSOLE</Link>
        </div>
      </nav>

      {/* 01 — HERO */}
      <section>
        <div className="inner">
          <div className="hero-grid">
            <div>
              <div className="eyebrow" style={{ marginBottom: 24 }}>
                IMMUTABLE PROVENANCE FOR THINGS MACHINES TRUST
              </div>
              <h1 className="display hero-word">
                PROOF
                <span className="l2">CHAIN</span>
              </h1>
              <p style={{ marginTop: 28, maxWidth: 460, color: 'var(--ink-dim)', fontSize: 16 }}>
                Trust the Origin. Verify the Integrity. A blockchain-backed provenance
                infrastructure for AI datasets, machine-learning models and software artifacts.
              </p>
              <div className="row" style={{ marginTop: 32 }}>
                <Link to="/app/register" className="btn primary">REGISTER ARTIFACT</Link>
                <Link to="/app/verify" className="btn">VERIFY INTEGRITY</Link>
                <Link to="/app/settings" className="btn ghost">VIEW DEMO</Link>
              </div>
            </div>

            <div className="hash-console reveal" aria-label="live SHA-256 computation">
              <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', justifyContent: 'space-between' }}>
                <span className="mono-xs faint">LIVE — HASHED IN YOUR BROWSER</span>
                <span className="mono-xs accent">WebCrypto</span>
              </div>
              <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <span className="k mono-xs">INPUT</span>
                <span className="v dim">"{HERO_INPUT}"</span>
              </div>
              <div className="row" style={{ padding: '12px 16px' }}>
                <span className="k mono-xs">SHA-256</span>
                <span className="v" style={{ color: 'var(--accent-hi)', minHeight: 42 }}>
                  {revealed}
                  {shown < digest.length && <span style={{ opacity: 0.5 }}>▌</span>}
                </span>
              </div>
            </div>
          </div>

          <div className="registry-strip">
            <div className="cell">
              <span className="mono-xs faint">NETWORK</span>
              <span className="mono" style={{ fontSize: 15 }}>
                {apiUp ? (net.network === 'localhost' ? 'LOCAL ETHEREUM' : net.network.toUpperCase()) : 'OFFLINE'}
              </span>
              <span className="mono-xs dim">{apiUp ? `chainId ${net.chainId}` : 'start the stack'}</span>
            </div>
            <div className="cell">
              <span className="mono-xs faint">REGISTRY CONTRACT</span>
              <span className="mono" style={{ fontSize: 15 }}>{net?.contractAddress ? shortHex(net.contractAddress, 8, 6) : '—'}</span>
              <span className="mono-xs dim">{net?.contractAddress ? 'deployed' : 'not deployed'}</span>
            </div>
            <div className="cell">
              <span className="mono-xs faint">LATEST BLOCK</span>
              <span className="mono" style={{ fontSize: 15 }}>{net?.latestBlock != null ? `#${net.latestBlock}` : '—'}</span>
              <span className="mono-xs dim">{net?.chainUp ? 'chain live' : 'chain down'}</span>
            </div>
            <div className="cell">
              <span className="mono-xs faint">ARTIFACTS REGISTERED</span>
              <span className="mono" style={{ fontSize: 15 }}>{stats?.totalArtifacts ?? '—'}</span>
              <span className="mono-xs dim">{stats ? `${stats.blockchainTransactions} chain txs` : 'no index'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 02 — THE PROBLEM */}
      <section>
        <div className="inner grid-2" style={{ alignItems: 'center' }}>
          <div>
            <div className="eyebrow">THE PROBLEM</div>
            <h2 style={{ fontSize: 40, marginTop: 18, maxWidth: 420 }}>
              Files change. Silently.
            </h2>
            <div style={{ marginTop: 22, display: 'grid', gap: 10, maxWidth: 440, color: 'var(--ink-dim)', fontSize: 15 }}>
              <p>Datasets get relabeled after the paper is published.</p>
              <p>Model weights get swapped between evaluation and deployment.</p>
              <p>Package releases get rebuilt with something extra inside.</p>
              <p>Metadata says whatever its editor wants it to say.</p>
              <p style={{ color: 'var(--ink)' }}>
                A checksum on the same server as the file proves nothing — whoever changes the
                file changes the checksum.
              </p>
            </div>
          </div>
          <div className="hash-console">
            <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="k mono-xs">TRUST TODAY</span>
              <span className="v dim">ORIGINAL → MODIFIED → UNKNOWN</span>
            </div>
            <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="k mono-xs">PROOFCHAIN</span>
              <span className="v">HASH → BLOCKCHAIN → <span className="accent">PROOF</span></span>
            </div>
            <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.7 }}>
              The fingerprint is committed to a ledger nobody can quietly edit. The file can
              travel anywhere; the commitment stays put. Verification is re-hashing and asking
              the chain.
            </div>
          </div>
        </div>
      </section>

      {/* 03 — HOW IT WORKS */}
      <section id="how">
        <div className="inner">
          <div className="spread" style={{ marginBottom: 28 }}>
            <div>
              <div className="eyebrow">HOW PROOFCHAIN WORKS</div>
              <h2 style={{ fontSize: 34, marginTop: 14 }}>Seven stages, one commitment</h2>
            </div>
            <span className="mono-xs faint" style={{ maxWidth: 300 }}>
              The stages are sequential — each output feeds the next. Hover any stage.
            </span>
          </div>
          <div className="pipeline">
            {PIPELINE.map((stage) => (
              <div className="pipe-stage" key={stage.num}>
                <span className="num">{stage.num}</span>
                <span className="name">{stage.name}</span>
                <span className="desc">{stage.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 — ARTIFACTS */}
      <section>
        <div className="inner">
          <div className="eyebrow" style={{ marginBottom: 28 }}>SUPPORTED ASSETS</div>
          <div className="asset-rows">
            <div className="asset-row">
              <span className="idx">TYPE / 01</span>
              <h3>AI DATASETS</h3>
              <p>
                Directory-level integrity: every file is a Merkle leaf, the root is the on-chain
                fingerprint. Relabel one row in labels.csv and the root no longer exists in the
                registry.
              </p>
              <span className="mono dim">{stats ? `${stats.byType.DATASET} registered` : '—'}</span>
            </div>
            <div className="asset-row">
              <span className="idx">TYPE / 02</span>
              <h3>ML MODELS</h3>
              <p>
                Weights fingerprinted and linked to the dataset they were trained on — lineage is
                a parent pointer on-chain, so "which data produced this model" has a provable
                answer.
              </p>
              <span className="mono dim">{stats ? `${stats.byType.MODEL} registered` : '—'}</span>
            </div>
            <div className="asset-row">
              <span className="idx">TYPE / 03</span>
              <h3>SOFTWARE RELEASES</h3>
              <p>
                npm, PyPI or GitHub release payloads with repository URL and commit hash in
                metadata. Supply-chain verification becomes: hash what you installed, ask the
                chain.
              </p>
              <span className="mono dim">{stats ? `${stats.byType.SOFTWARE} registered` : '—'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 05/06 — PROVENANCE + CHAIN ACTIVITY */}
      <section>
        <div className="inner grid-2">
          <div>
            <div className="eyebrow">LIVE PROVENANCE</div>
            <h2 style={{ fontSize: 30, marginTop: 14, marginBottom: 20 }}>Lineage you can walk</h2>
            <div className="hash-console">
              {['Dataset v1.0', 'Dataset v1.1', 'FloodNet Model v1', 'FloodNet Model v2', 'Production release'].map(
                (label, i, arr) => (
                  <div className="row" key={label} style={{ padding: '11px 18px', borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                    <span className="mono-xs faint" style={{ width: 26 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span className="mono" style={{ paddingLeft: i * 18 }}>
                      {i > 0 && <span className="faint">└─ </span>}
                      {label}
                    </span>
                  </div>
                )
              )}
            </div>
            <p className="mono-xs faint" style={{ marginTop: 14 }}>
              Interactive graph with real registered lineage in the console →{' '}
              <Link to="/app/provenance" className="accent">PROVENANCE</Link>
            </p>
          </div>
          <div>
            <div className="eyebrow">BLOCKCHAIN ACTIVITY</div>
            <h2 style={{ fontSize: 30, marginTop: 14, marginBottom: 20 }}>The audit trail, live</h2>
            <div className="hash-console">
              {events && events.items.length > 0 ? (
                events.items.slice(0, 6).map((e, i, arr) => (
                  <div className="row" key={e.id} style={{ padding: '11px 18px', borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none', justifyContent: 'space-between' }}>
                    <span className="mono-xs dim">BLOCK #{e.blockNumber ?? '—'}</span>
                    <Tag tone={EVENT_TONE[e.type] ?? ''} dot={false}>{e.type}</Tag>
                    <span className="mono-xs faint">{e.artifactLabel ?? ''}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '26px 18px', textAlign: 'center' }} className="mono-xs faint">
                  {apiUp ? 'NO CONTRACT EVENTS YET — REGISTER AN ARTIFACT OR LOAD THE DEMO' : 'STACK OFFLINE — START THE BACKEND TO STREAM REAL EVENTS'}
                </div>
              )}
            </div>
            <p className="mono-xs faint" style={{ marginTop: 14 }}>
              Full explorer with blocks and transactions →{' '}
              <Link to="/app/blockchain" className="accent">BLOCKCHAIN</Link>
            </p>
          </div>
        </div>
      </section>

      {/* 07 — VERIFICATION */}
      <section id="verify">
        <div className="inner">
          <div className="eyebrow">VERIFICATION</div>
          <h2 style={{ fontSize: 34, marginTop: 14, marginBottom: 8 }}>Drop a file. Ask the chain.</h2>
          <p className="dim" style={{ maxWidth: 560, marginBottom: 28, fontSize: 14.5 }}>
            This is the real verifier — bytes are hashed in your browser and the API compares the
            fingerprint against the registry contract{apiUp ? '' : ' (backend offline right now)'}.
          </p>
          <div className="grid-2">
            <div className="stack">
              <FileDrop compact onReady={setDropped} onClear={() => { setDropped(null); setVerdict(null); }} />
              <button className="btn primary" disabled={!dropped || verifying || !apiUp} onClick={() => void runVerify()}>
                {verifying ? 'QUERYING BLOCKCHAIN…' : 'VERIFY AGAINST THE REGISTRY'}
              </button>
              {verifyError && <div className="notice err">{verifyError}</div>}
            </div>
            <div>
              {verdict ? (
                <VerifyResultPanel result={verdict} />
              ) : (
                <div className="hash-console">
                  <div className="row" style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
                    <span className="k mono-xs">MATCH</span>
                    <span className="v ok">✓ INTEGRITY VERIFIED — hash equals the on-chain commitment</span>
                  </div>
                  <div className="row" style={{ padding: '12px 18px' }}>
                    <span className="k mono-xs">MISMATCH</span>
                    <span className="v bad">✕ INTEGRITY MISMATCH — registered vs current digests shown side by side</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 08 — AI ANALYSIS */}
      <section id="analysis">
        <div className="inner grid-2" style={{ alignItems: 'center' }}>
          <div>
            <div className="eyebrow">AI RISK ANALYSIS</div>
            <h2 style={{ fontSize: 34, marginTop: 14, maxWidth: 420 }}>
              Anomalies flagged, never verdicts invented
            </h2>
            <p className="dim" style={{ marginTop: 18, maxWidth: 460, fontSize: 14.5 }}>
              An Isolation Forest fitted on the registered population plus deterministic rules
              over real history: size jumps between versions, rapid re-releases, failed
              verifications, ownership churn, revocations. The blockchain proves integrity; the
              model only points at what deserves a closer look.
            </p>
          </div>
          <div className="hash-console">
            <div className="row" style={{ padding: '11px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="k mono-xs">SERVICE</span>
              <span className="v">{aiStatus?.up ? <span className="ok">ONLINE — FastAPI + scikit-learn</span> : <span className="dim">OFFLINE (analysis reported unavailable, never faked)</span>}</span>
            </div>
            <div className="row" style={{ padding: '11px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="k mono-xs">MODEL</span>
              <span className="v dim">{aiStatus?.info?.mlModelVersion ?? 'isolation-forest-v1'} / {aiStatus?.info?.baselineVersion ?? 'rule-baseline-v1'}</span>
            </div>
            <div className="row" style={{ padding: '11px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="k mono-xs">FEATURES</span>
              <span className="v dim">{aiStatus?.info?.features.length ?? 14} per artifact</span>
            </div>
            <div className="row" style={{ padding: '11px 18px' }}>
              <span className="k mono-xs">RISK LEVELS</span>
              <span className="v"><span className="ok">LOW</span> <span className="warn">MEDIUM</span> <span style={{ color: 'var(--chart-serious)' }}>HIGH</span> <span className="bad">CRITICAL</span></span>
            </div>
          </div>
        </div>
      </section>

      {/* 09 — FINAL CTA */}
      <section style={{ borderBottom: 'none' }}>
        <div className="inner" style={{ textAlign: 'center', padding: '40px 0' }}>
          <h2 className="display" style={{ fontSize: 'clamp(36px, 6vw, 72px)' }}>
            PROVE WHAT <span className="accent">CHANGED.</span>
            <br />
            VERIFY WHAT <span className="accent">MATTERS.</span>
          </h2>
          <div className="row" style={{ justifyContent: 'center', marginTop: 36 }}>
            <Link to="/app/register" className="btn primary">REGISTER ARTIFACT</Link>
            <Link to="/app/verify" className="btn">VERIFY FILE</Link>
          </div>
          <div className="mono-xs faint" style={{ marginTop: 56, display: 'grid', gap: 6 }}>
            <span>SOLIDITY 0.8 · HARDHAT · ETHERS V6 · EXPRESS · PRISMA · FASTAPI · SCIKIT-LEARN · REACT</span>
            <span>
              {net?.contractAddress ? (
                <>REGISTRY <Hash value={net.contractAddress} head={10} tail={8} /> ON {net.network.toUpperCase()}</>
              ) : (
                'LOCAL-FIRST: RUNS ENTIRELY ON YOUR MACHINE'
              )}
            </span>
            <span>ENGINEERED AS A FINAL-YEAR BLOCKCHAIN PROJECT · {formatDate(new Date().toISOString()).split(',')[0]}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
