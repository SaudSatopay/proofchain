import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ArtifactRecord, ArtifactType } from '@proofchain/types';
import { api, ApiRequestError, type PreparedSummary } from '../lib/api';
import { sendRegistration, useWallet, connectWallet, ensureNetwork } from '../lib/wallet';
import { FileDrop, type FileDropResult } from '../components/FileDrop';
import { TxStepper, type TxPhase } from '../components/TxStepper';
import { Hash, KV, Panel, Tag } from '../components/ui';
import { useSession } from './AppLayout';
import { formatBytes } from '../lib/format';

const TYPE_FIELDS: Record<ArtifactType, { key: string; label: string; placeholder: string }[]> = {
  DATASET: [
    { key: 'organization', label: 'ORGANIZATION', placeholder: 'Research Lab' },
    { key: 'license', label: 'LICENSE', placeholder: 'CC-BY-4.0 / MIT / proprietary' },
    { key: 'datasetFormat', label: 'DATASET FORMAT', placeholder: 'JPEG + CSV' },
  ],
  MODEL: [
    { key: 'framework', label: 'FRAMEWORK', placeholder: 'PyTorch / TensorFlow / Scikit-learn / ONNX' },
    { key: 'modelType', label: 'MODEL TYPE', placeholder: 'CNN classifier' },
    { key: 'datasetUsed', label: 'DATASET USED', placeholder: 'Flood Detection Dataset v1.2' },
    { key: 'trainingConfig', label: 'TRAINING CONFIG', placeholder: 'epochs=40 lr=3e-4 batch=32' },
  ],
  SOFTWARE: [
    { key: 'developer', label: 'DEVELOPER', placeholder: 'Platform Team' },
    { key: 'repositoryUrl', label: 'REPOSITORY URL', placeholder: 'https://github.com/org/repo' },
    { key: 'commitHash', label: 'COMMIT HASH', placeholder: '9c2f41a' },
    { key: 'packageManager', label: 'PACKAGE MANAGER', placeholder: 'npm / PyPI / GitHub release' },
  ],
};

const CAN_WRITE = new Set(['ADMIN', 'RESEARCHER', 'DEVELOPER']);

export function RegisterPage() {
  const session = useSession();
  const wallet = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const parentChainId = params.get('parent') ? Number(params.get('parent')) : null;
  const asVersion = params.get('asVersion') === '1' && parentChainId != null;

  const { data: net } = useQuery({ queryKey: ['network'], queryFn: api.networkConfig });

  const [artifactType, setArtifactType] = useState<ArtifactType>(
    (params.get('type') as ArtifactType) || 'DATASET'
  );
  const [name, setName] = useState(params.get('name') ?? '');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [creator, setCreator] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<FileDropResult | null>(null);
  const [signerChoice, setSignerChoice] = useState<'wallet' | 'server'>('server');

  const [phase, setPhase] = useState<TxPhase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedSummary | null>(null);
  const [result, setResult] = useState<ArtifactRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canWrite = session.user && CAN_WRITE.has(session.user.role);
  const busy = phase !== 'idle' && phase !== 'confirmed' && phase !== 'failed';

  const valid = useMemo(
    () => name.trim().length > 0 && version.trim().length > 0 && dropped != null,
    [name, version, dropped]
  );

  const submit = async () => {
    if (!dropped || !valid) return;
    setError(null);
    setResult(null);
    setTxHash(null);
    try {
      setPhase('hashing');
      const form = new FormData();
      for (const f of dropped.files) form.append('files', f.file, f.file.name);
      form.append('paths', JSON.stringify(dropped.files.map((f) => f.path)));
      form.append('artifactType', artifactType);
      form.append('name', name.trim());
      form.append('version', version.trim());
      form.append('description', description.trim());
      form.append('creator', creator.trim());
      form.append('fields', JSON.stringify(fields));
      if (parentChainId) {
        form.append('parentChainId', String(parentChainId));
        form.append('asVersion', asVersion ? 'true' : 'false');
      }

      setPhase('storing');
      const preparedRes = await api.prepare(form);
      setPrepared(preparedRes);
      if (preparedRes.duplicate.exists) {
        setPhase('failed');
        setError(
          `This exact fingerprint is already registered on-chain as artifact #${preparedRes.duplicate.artifactId}. Identical bytes cannot be registered twice.`
        );
        return;
      }

      setPhase('signing');
      let confirmed: ArtifactRecord;
      if (signerChoice === 'wallet') {
        if (!wallet.address) {
          await connectWallet();
        }
        if (net && wallet.chainId !== net.chainId) {
          const switched = await ensureNetwork(net.chainId, net.rpcUrl, net.network);
          if (!switched) throw new Error(`MetaMask is on the wrong network — switch to chain ${net.chainId}.`);
        }
        if (!net?.contractAddress) throw new Error('Registry contract is not deployed.');
        const { txHash: hash } = await sendRegistration(
          net.contractAddress,
          {
            asVersion,
            parentChainId,
            artifactType,
            name: name.trim(),
            version: version.trim(),
            artifactHash: preparedRes.artifactHash,
            metadataCid: preparedRes.metadataCid,
          },
          {
            onPending: (h) => {
              setTxHash(h);
              setPhase('pending');
            },
          }
        );
        const res = await api.confirmWalletTx(preparedRes.preparedId, hash);
        confirmed = res.artifact;
      } else {
        setPhase('pending');
        const res = await api.registerServer(preparedRes.preparedId);
        confirmed = res.artifact;
        setTxHash(confirmed.txHash);
      }

      setPhase('confirmed');
      setResult(confirmed);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
    } catch (err) {
      setPhase('failed');
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : String(err));
    }
  };

  if (!session.user) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">REGISTER ARTIFACT</div>
          <h1>Authentication required</h1>
        </div>
        <div className="notice">
          Registering artifacts writes to the registry and requires an application account with
          the RESEARCHER, DEVELOPER or ADMIN role. <Link className="accent" to="/login">Sign in</Link> — read-only
          browsing and verification stay open without an account.
        </div>
      </div>
    );
  }
  if (!canWrite) {
    return (
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">REGISTER ARTIFACT</div>
          <h1>Insufficient role</h1>
        </div>
        <div className="notice err">
          Your role ({session.user.role}) is read-oriented. Registration requires RESEARCHER,
          DEVELOPER or ADMIN.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">{asVersion ? 'NEW VERSION' : 'REGISTER ARTIFACT'}</div>
        <h1>{asVersion ? `New version of #${parentChainId}` : 'Establish provenance'}</h1>
        <p className="sub">
          Files are hashed locally, stored via the {net?.storageMode === 'pinata' ? 'IPFS' : 'local development storage'} layer,
          and the fingerprint is committed to the registry contract in a real transaction.
        </p>
      </div>

      <div className="grid-2">
        <div className="stack">
          <Panel title="01 — ARTIFACT FILES">
            <FileDrop onReady={setDropped} onClear={() => setDropped(null)} />
          </Panel>

          <Panel title="02 — METADATA">
            <div className="stack">
              {!asVersion && (
                <div className="field">
                  <label>ARTIFACT TYPE</label>
                  <select value={artifactType} onChange={(e) => setArtifactType(e.target.value as ArtifactType)}>
                    <option value="DATASET">AI DATASET</option>
                    <option value="MODEL">ML MODEL</option>
                    <option value="SOFTWARE">SOFTWARE RELEASE</option>
                  </select>
                </div>
              )}
              <div className="grid-2" style={{ gap: 14 }}>
                <div className="field">
                  <label>NAME</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flood Detection Dataset" disabled={asVersion} />
                </div>
                <div className="field">
                  <label>VERSION</label>
                  <input className="mono-input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.0" />
                </div>
              </div>
              <div className="field">
                <label>DESCRIPTION</label>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this artifact, and what should verifiers know about it?" />
              </div>
              <div className="field">
                <label>CREATOR</label>
                <input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="Research Lab" />
              </div>
              <div className="grid-2" style={{ gap: 14 }}>
                {TYPE_FIELDS[artifactType].map((f) => (
                  <div className="field" key={f.key}>
                    <label>{f.label}</label>
                    <input
                      value={fields[f.key] ?? ''}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="03 — SIGNER">
            <div className="stack-sm">
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={signerChoice === 'server'}
                  onChange={() => setSignerChoice('server')}
                />
                <span className="mono-xs">LOCAL DEV SIGNER</span>
                <span className="mono-xs faint">API signs with the Hardhat dev account</span>
              </label>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={signerChoice === 'wallet'}
                  onChange={() => setSignerChoice('wallet')}
                />
                <span className="mono-xs">METAMASK</span>
                <span className="mono-xs faint">
                  {wallet.available
                    ? wallet.address
                      ? `connected ${wallet.address.slice(0, 8)}…`
                      : 'you sign the transaction in your wallet'
                    : 'extension not detected'}
                </span>
              </label>
              {signerChoice === 'wallet' && !wallet.address && (
                <button className="btn sm" onClick={() => void connectWallet()}>CONNECT WALLET</button>
              )}
              <p className="mono-xs faint">
                Both paths produce a real on-chain transaction. On-chain ownership belongs to the
                signing address.
              </p>
            </div>
          </Panel>

          <button className="btn primary" style={{ padding: '16px 24px' }} disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'WORKING…' : asVersion ? 'COMMIT NEW VERSION ON-CHAIN' : 'COMMIT FINGERPRINT ON-CHAIN'}
          </button>

          <TxStepper phase={phase} error={error} txHash={txHash} />
          {error && phase === 'failed' && <div className="notice err">{error}</div>}

          {prepared && phase !== 'failed' && (
            <Panel title="PREPARED COMMITMENT">
              <KV
                rows={[
                  ['FINGERPRINT', <Hash key="f" value={prepared.artifactHash} head={18} tail={10} />],
                  ...(prepared.merkleRoot
                    ? ([['MERKLE TREE', <span key="m" className="mono-xs dim">{prepared.merkleLayers?.join(' → ')} nodes/layer</span>]] as [string, React.ReactNode][])
                    : []),
                  ['STORAGE', <span key="s" className="mono-xs">{prepared.storageMode === 'pinata' ? 'IPFS (Pinata)' : 'LOCAL DEVELOPMENT STORAGE'}</span>],
                  ['METADATA CID', <Hash key="c" value={prepared.metadataCid} head={18} tail={8} />],
                  ['PAYLOAD', <span key="p" className="mono-xs dim">{prepared.fileCount} files · {formatBytes(prepared.sizeBytes)}</span>],
                ]}
              />
            </Panel>
          )}

          {result && (
            <div className="verdict pass reveal">
              <div className="verdict-head">
                <div className="mark">✓</div>
                <div>
                  <div className="verdict-title">Registered on-chain</div>
                  <div className="mono-xs dim">artifact #{result.chainId} · block #{result.blockNumber}</div>
                </div>
              </div>
              <div className="panel-body stack-sm">
                <KV
                  rows={[
                    ['TRANSACTION', <Hash key="t" value={result.txHash} head={16} tail={10} />],
                    ['CONTRACT', <Hash key="c" value={result.contractAddress} />],
                    ['OWNER', <Hash key="o" value={result.ownerAddress} />],
                    ['GAS USED', <span key="g" className="mono">{result.gasUsed ?? '—'}</span>],
                  ]}
                />
                <div className="row">
                  <button className="btn primary sm" onClick={() => navigate(`/app/artifacts/${result.chainId}`)}>
                    OPEN ARTIFACT PAGE →
                  </button>
                  <Tag tone="ok">PROVENANCE ESTABLISHED</Tag>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
