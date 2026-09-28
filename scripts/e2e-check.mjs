/**
 * End-to-end smoke check against a RUNNING stack (chain + api [+ ai]).
 * Exercises the full pipeline with real transactions:
 *
 *   health → network config → login → prepare (hash+store) →
 *   register on-chain → fetch artifact → verify identical files (match) →
 *   verify tampered files (mismatch + manifest diff) → AI analysis →
 *   dashboard stats → explorer blocks
 *
 * Usage: node scripts/e2e-check.mjs   (API on :4000 must be up)
 */
const API = process.env.API_URL || 'http://127.0.0.1:4000';

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const json = async (res) => {
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

const files = {
  'images/a.jpg': `e2e-image-a-${Date.now()}`,
  'images/b.jpg': `e2e-image-b-${Date.now()}`,
  'labels.csv': 'id,label\n1,flood\n2,dry\n',
};

function formData(fileMap) {
  const fd = new FormData();
  const paths = Object.keys(fileMap);
  for (const p of paths) {
    fd.append('files', new Blob([fileMap[p]]), p.split('/').pop());
  }
  fd.append('paths', JSON.stringify(paths));
  return fd;
}

async function main() {
  console.log(`ProofChain e2e check against ${API}\n`);

  // 1) Health + network
  const health = await json(await fetch(`${API}/api/health`));
  check('API health', health.status === 200 && health.body?.ok === true);

  const net = await json(await fetch(`${API}/api/network/config`));
  check('chain reachable', net.body?.chainUp === true, `network=${net.body?.network}`);
  check('registry deployed', typeof net.body?.contractAddress === 'string' && net.body.contractAddress.startsWith('0x'), net.body?.contractAddress ?? '');

  // 2) Login
  const login = await json(
    await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@proofchain.local', password: 'proofchain-demo' }),
    })
  );
  check('admin login', login.status === 200 && Boolean(login.body?.token));
  const auth = { Authorization: `Bearer ${login.body?.token}` };

  // 3) Prepare (hash + store)
  const fd = formData(files);
  fd.append('artifactType', 'DATASET');
  fd.append('name', `E2E Dataset ${new Date().toISOString()}`);
  fd.append('version', 'v1.0');
  fd.append('description', 'End-to-end pipeline check dataset');
  fd.append('creator', 'e2e-runner');
  const prepared = await json(
    await fetch(`${API}/api/artifacts/prepare`, { method: 'POST', headers: auth, body: fd })
  );
  check('prepare: fingerprint computed', prepared.status === 200 && /^0x[0-9a-f]{64}$/.test(prepared.body?.artifactHash ?? ''), prepared.body?.artifactHash?.slice(0, 18));
  check('prepare: merkle root for multi-file', Boolean(prepared.body?.merkleRoot), `${prepared.body?.fileCount} files`);
  check('prepare: stored to storage layer', typeof prepared.body?.metadataCid === 'string' && prepared.body.metadataCid.length > 0, prepared.body?.storageMode);

  // 4) Register on-chain (server dev signer → real transaction)
  const registered = await json(
    await fetch(`${API}/api/artifacts/register`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preparedId: prepared.body.preparedId }),
    })
  );
  const artifact = registered.body?.artifact;
  check('register: on-chain transaction confirmed', registered.status === 200 && /^0x[0-9a-f]{64}$/i.test(artifact?.txHash ?? ''), `tx=${artifact?.txHash?.slice(0, 14)} block=${artifact?.blockNumber}`);
  check('register: chain artifact id assigned', Number.isInteger(artifact?.chainId) && artifact.chainId > 0, `#${artifact?.chainId}`);
  check('register: gas recorded', Boolean(artifact?.gasUsed), `gas=${artifact?.gasUsed}`);

  // 5) Artifact detail
  const detail = await json(await fetch(`${API}/api/artifacts/${artifact.chainId}`));
  check('artifact detail served', detail.status === 200 && detail.body?.artifact?.artifactHash === prepared.body.artifactHash);
  check('artifact files listed', Array.isArray(detail.body?.files) && detail.body.files.length === 3);

  // 6) Verify identical files → INTEGRITY VERIFIED
  const verifyOk = await json(
    await fetch(`${API}/api/verify`, { method: 'POST', body: formData(files) })
  );
  check('verify identical: matched', verifyOk.body?.matched === true);
  check('verify identical: hash equals registered', verifyOk.body?.registeredHash === prepared.body.artifactHash);
  check('verify identical: resolved artifact', verifyOk.body?.artifact?.chainId === artifact.chainId);

  // 7) Verify tampered files → INTEGRITY MISMATCH with manifest diff
  const tampered = { ...files, 'labels.csv': 'id,label\n1,dry\n2,dry\n' };
  const verifyBad = await json(
    await fetch(`${API}/api/verify`, { method: 'POST', body: formData(tampered) })
  );
  check('verify tampered: mismatch detected', verifyBad.body?.matched === false);
  check('verify tampered: original identified via manifest', verifyBad.body?.artifact?.chainId === artifact.chainId);
  check(
    'verify tampered: modified file named',
    Array.isArray(verifyBad.body?.manifestDiff?.modified) && verifyBad.body.manifestDiff.modified.includes('labels.csv'),
    JSON.stringify(verifyBad.body?.manifestDiff ?? null)
  );
  check('verify tampered: registered vs current hashes differ', verifyBad.body?.registeredHash !== verifyBad.body?.suppliedHash);

  // 8) AI analysis (honest skip if service down)
  const aiStatus = await json(await fetch(`${API}/api/ai/status`));
  if (aiStatus.body?.up) {
    const analysis = await json(
      await fetch(`${API}/api/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId: artifact.chainId }),
      })
    );
    check('ai: risk score returned', typeof analysis.body?.riskScore === 'number' && analysis.body.riskScore >= 0 && analysis.body.riskScore <= 1, `score=${analysis.body?.riskScore} level=${analysis.body?.riskLevel}`);
    check('ai: mode + model version stated', ['ML', 'BASELINE'].includes(analysis.body?.mode) && Boolean(analysis.body?.modelVersion), `${analysis.body?.mode}/${analysis.body?.modelVersion}`);
  } else {
    console.log('  SKIP  ai analysis (service not running)');
  }

  // 9) Dashboard + explorer
  const stats = await json(await fetch(`${API}/api/dashboard/stats`));
  check('dashboard: real totals', stats.body?.totalArtifacts >= 1 && stats.body?.integrityViolations >= 1);

  const blocks = await json(await fetch(`${API}/api/blockchain/blocks?limit=5`));
  check('explorer: real blocks listed', Array.isArray(blocks.body?.blocks) && blocks.body.blocks.length > 0, `latest=#${blocks.body?.latestBlock}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('e2e runner crashed:', err);
  process.exit(1);
});
