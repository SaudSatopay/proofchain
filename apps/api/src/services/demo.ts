/**
 * Demo mode. Everything here runs through the REAL pipeline: files are
 * generated, hashed, stored, committed on-chain via actual transactions
 * signed by the local dev account, then indexed from chain events. The
 * "integrity violation" writes different bytes into the stored object of
 * one artifact so a later verification genuinely fails against the
 * on-chain commitment — nothing is simulated at the UI level.
 */
import fs from 'node:fs';
import type { FileInput } from '@proofchain/crypto';
import { prisma } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { isChainUp, redeployRegistry, serverSignerAddress } from './chain.js';
import { ipfsService } from './storage.js';
import {
  prepareUpload,
  registerServerSide,
  revokeServerSide,
  transferServerSide,
  type ArtifactMetadataDoc,
  type RegistrationPayload,
} from './artifacts.js';
import { verifyStoredCopy } from './verify.js';
import { aiServiceUp, runAnalysis } from './ai.js';

// Hardhat's publicly known dev account #1 — used only as the RECIPIENT of
// the demo ownership transfer (no key needed, it's just an address).
const DEMO_TRANSFER_RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const TAMPER_TARGET = 'Sensor Calibration Dataset';
const DEMO_MARKER = 'Flood Detection Dataset';

// ── Deterministic synthetic file generation ────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pseudoBytes(seed: number, length: number): Uint8Array {
  const rand = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

function floodDatasetFiles(version: string, seed: number, labelTweak = ''): FileInput[] {
  const files: FileInput[] = [];
  for (let i = 1; i <= 6; i++) {
    files.push({ path: `images/flood_${String(i).padStart(3, '0')}.jpg`, bytes: pseudoBytes(seed + i, 4096 + i * 512) });
  }
  files.push({
    path: 'labels.csv',
    bytes: text(
      `image,label,region,captured_at\n` +
        `flood_001.jpg,flooded,riverside,2025-05-11\n` +
        `flood_002.jpg,flooded,riverside,2025-05-11\n` +
        `flood_003.jpg,dry,uptown,2025-05-12\n` +
        `flood_004.jpg,flooded,delta,2025-05-13${labelTweak}\n` +
        `flood_005.jpg,dry,uptown,2025-05-14\n` +
        `flood_006.jpg,flooded,delta,2025-05-15\n`
    ),
  });
  files.push({
    path: 'README.md',
    bytes: text(`# Flood Detection Dataset ${version}\n\nSynthetic demo data for ProofChain.\n`),
  });
  return files;
}

function modelFile(version: string, seed: number, size: number): FileInput[] {
  const header = text(`FLOODNET-WEIGHTS ${version}\n`);
  const weights = pseudoBytes(seed, size);
  const bytes = new Uint8Array(header.length + weights.length);
  bytes.set(header, 0);
  bytes.set(weights, header.length);
  return [{ path: `floodnet-${version}.pt`, bytes }];
}

function packageFiles(version: string, seed: number, extraSize = 0): FileInput[] {
  const files: FileInput[] = [
    {
      path: 'package/package.json',
      bytes: text(
        JSON.stringify({ name: 'flood-detector-api', version: version.replace(/^v/, ''), main: 'index.js', license: 'MIT' }, null, 2)
      ),
    },
    {
      path: 'package/index.js',
      bytes: text(`// flood-detector-api ${version}\nmodule.exports.predict = (img) => ({ flooded: img.length % 2 === 0 });\n`),
    },
    { path: 'package/README.md', bytes: text(`# flood-detector-api ${version}\n`) },
  ];
  if (extraSize > 0) {
    files.push({ path: 'package/vendor/blob.bin', bytes: pseudoBytes(seed, extraSize) });
  }
  return files;
}

function calibrationFiles(): FileInput[] {
  return [
    {
      path: 'calibration.csv',
      bytes: text(
        `sensor_id,offset,scale\nS-001,0.02,1.001\nS-002,-0.01,0.998\nS-003,0.00,1.000\nS-004,0.05,1.012\n`
      ),
    },
    { path: 'notes.txt', bytes: text('Calibration run 2025-06-02, lab conditions 21C.\n') },
  ];
}

// ── Demo orchestration ─────────────────────────────────────

async function registerDemoArtifact(
  files: FileInput[],
  payload: RegistrationPayload
): Promise<number> {
  const prepared = await prepareUpload(files, payload, null);
  const record = await registerServerSide(prepared.preparedId);
  return record.chainId;
}

export async function demoStatus() {
  const [loaded, tamperTarget] = await Promise.all([
    prisma.artifact.findFirst({ where: { name: DEMO_MARKER } }),
    prisma.artifact.findFirst({ where: { name: TAMPER_TARGET } }),
  ]);
  let tampered = false;
  if (tamperTarget) {
    const metadata = await ipfsService.getJson<ArtifactMetadataDoc>(tamperTarget.metadataCid);
    const first = metadata?.files?.[0];
    if (first) {
      const path = ipfsService.localObjectPath(first.cid);
      tampered = Boolean(path && fs.existsSync(`${path}.orig`));
    }
  }
  return {
    loaded: Boolean(loaded),
    tampered,
    artifactCount: await prisma.artifact.count(),
    serverSigner: serverSignerAddress(),
  };
}

export async function loadDemoData() {
  if (!(await isChainUp())) {
    throw new AppError(503, 'CHAIN_UNAVAILABLE', 'Start the local Hardhat node first (`npm run chain`).');
  }
  const existing = await prisma.artifact.findFirst({ where: { name: DEMO_MARKER } });
  if (existing) throw badRequest('Demo data is already loaded. Use "Reset demo" first to reload.');

  const log: string[] = [];
  const base = {
    description: '',
    creator: 'Riverline Research Lab',
    fields: {},
    parentChainId: null as number | null,
    asVersion: false,
  };

  // 1) Flood Detection Dataset v1.0 → v1.1 → v1.2
  const ds10 = await registerDemoArtifact(floodDatasetFiles('v1.0', 100), {
    ...base,
    artifactType: 'DATASET',
    name: 'Flood Detection Dataset',
    version: 'v1.0',
    description: 'Satellite frames with flood/dry labels used to train FloodNet.',
    fields: { organization: 'Riverline Research Lab', license: 'CC-BY-4.0', datasetFormat: 'JPEG + CSV' },
  });
  log.push(`Registered Flood Detection Dataset v1.0 → artifact #${ds10}`);

  const ds11 = await registerDemoArtifact(floodDatasetFiles('v1.1', 100, '\nflood_004b.jpg,flooded,delta,2025-05-13'), {
    ...base,
    artifactType: 'DATASET',
    name: 'Flood Detection Dataset',
    version: 'v1.1',
    description: 'Adds delta-region relabeling pass.',
    fields: { organization: 'Riverline Research Lab', license: 'CC-BY-4.0', datasetFormat: 'JPEG + CSV' },
    parentChainId: ds10,
    asVersion: true,
  });
  const ds12 = await registerDemoArtifact(floodDatasetFiles('v1.2', 104), {
    ...base,
    artifactType: 'DATASET',
    name: 'Flood Detection Dataset',
    version: 'v1.2',
    description: 'Re-captured uptown frames after sensor maintenance.',
    fields: { organization: 'Riverline Research Lab', license: 'CC-BY-4.0', datasetFormat: 'JPEG + CSV' },
    parentChainId: ds11,
    asVersion: true,
  });
  log.push(`Versions v1.1 (#${ds11}) and v1.2 (#${ds12}) linked to the dataset lineage`);

  // 2) FloodNet models — v1 derived from the dataset, v2 as a model version
  const m1 = await registerDemoArtifact(modelFile('v1', 200, 96 * 1024), {
    ...base,
    artifactType: 'MODEL',
    name: 'FloodNet Model',
    version: 'v1',
    description: 'CNN flood classifier trained on Flood Detection Dataset v1.2.',
    fields: { framework: 'PyTorch', modelType: 'CNN classifier', datasetUsed: 'Flood Detection Dataset v1.2', trainingConfig: 'epochs=40 lr=3e-4 batch=32' },
    parentChainId: ds12,
    asVersion: false, // derived artifact, not a version of the dataset
  });
  const m2 = await registerDemoArtifact(modelFile('v2', 201, 118 * 1024), {
    ...base,
    artifactType: 'MODEL',
    name: 'FloodNet Model',
    version: 'v2',
    description: 'Adds delta-region augmentation; +4.1 F1 over v1.',
    fields: { framework: 'PyTorch', modelType: 'CNN classifier', datasetUsed: 'Flood Detection Dataset v1.2', trainingConfig: 'epochs=55 lr=2e-4 batch=32' },
    parentChainId: m1,
    asVersion: true,
  });
  log.push(`FloodNet Model v1 (#${m1}, derived from dataset) and v2 (#${m2})`);

  // 3) flood-detector-api — normal v1.0.0/v1.1.0, then a suspicious v1.1.1
  //    with an 8× size jump published immediately after (anomaly target).
  const sw1 = await registerDemoArtifact(packageFiles('v1.0.0', 300), {
    ...base,
    artifactType: 'SOFTWARE',
    name: 'flood-detector-api',
    version: 'v1.0.0',
    description: 'REST wrapper around FloodNet for municipal alerting.',
    creator: 'Riverline Platform Team',
    fields: { developer: 'Riverline Platform Team', repositoryUrl: 'https://git.local/riverline/flood-detector-api', commitHash: '9c2f41a', packageManager: 'npm', license: 'MIT' },
  });
  const sw2 = await registerDemoArtifact(packageFiles('v1.1.0', 301), {
    ...base,
    artifactType: 'SOFTWARE',
    name: 'flood-detector-api',
    version: 'v1.1.0',
    description: 'Adds rate limiting and health endpoint.',
    creator: 'Riverline Platform Team',
    fields: { developer: 'Riverline Platform Team', repositoryUrl: 'https://git.local/riverline/flood-detector-api', commitHash: 'e11d093', packageManager: 'npm', license: 'MIT' },
    parentChainId: sw1,
    asVersion: true,
  });
  const sw3 = await registerDemoArtifact(packageFiles('v1.1.1', 302, 2 * 1024 * 1024), {
    ...base,
    artifactType: 'SOFTWARE',
    name: 'flood-detector-api',
    version: 'v1.1.1',
    description: 'Patch release. (Deliberately anomalous for the demo: 8× size jump, published minutes after v1.1.0.)',
    creator: 'Riverline Platform Team',
    fields: { developer: 'Riverline Platform Team', repositoryUrl: 'https://git.local/riverline/flood-detector-api', commitHash: 'f00dfeed', packageManager: 'npm', license: 'MIT' },
    parentChainId: sw2,
    asVersion: true,
  });
  log.push(`flood-detector-api v1.0.0 (#${sw1}) → v1.1.0 (#${sw2}) → v1.1.1 (#${sw3}, anomalous size jump)`);

  // 4) Tamper target — registered intact; "Simulate integrity violation"
  //    later rewrites its stored bytes.
  const cal = await registerDemoArtifact(calibrationFiles(), {
    ...base,
    artifactType: 'DATASET',
    name: TAMPER_TARGET,
    version: 'v1.0',
    description: 'Per-sensor calibration table shipped with field units.',
    fields: { organization: 'Riverline Research Lab', license: 'CC-BY-4.0', datasetFormat: 'CSV' },
  });
  log.push(`${TAMPER_TARGET} v1.0 (#${cal}) — target for the integrity-violation demo`);

  // 5) Ownership transfer + revocation events
  const legacy = await registerDemoArtifact(
    [{ path: 'toolkit.py', bytes: text('# legacy preprocessing toolkit v0.9.0\n') }],
    {
      ...base,
      artifactType: 'SOFTWARE',
      name: 'legacy-preprocessing-toolkit',
      version: 'v0.9.0',
      description: 'Handed over to the platform team.',
      fields: { developer: 'Riverline Research Lab', packageManager: 'PyPI', license: 'MIT' },
    }
  );
  await transferServerSide(legacy, DEMO_TRANSFER_RECIPIENT);
  log.push(`legacy-preprocessing-toolkit (#${legacy}) ownership transferred to ${DEMO_TRANSFER_RECIPIENT}`);

  const deprecated = await registerDemoArtifact(
    [{ path: 'augment.sh', bytes: text('#!/bin/sh\n# deprecated augmentation scripts\n') }],
    {
      ...base,
      artifactType: 'SOFTWARE',
      name: 'deprecated-augmentation-scripts',
      version: 'v0.1.0',
      description: 'Superseded by FloodNet built-in augmentation; revoked.',
      fields: { developer: 'Riverline Research Lab', packageManager: 'GitHub release', license: 'MIT' },
    }
  );
  await revokeServerSide(deprecated);
  log.push(`deprecated-augmentation-scripts (#${deprecated}) revoked on-chain`);

  // 6) Baseline verifications so the dashboard has real verification data.
  await verifyStoredCopy(ds10);
  await verifyStoredCopy(m2);
  await verifyStoredCopy(sw2);
  log.push('Verified stored copies of dataset v1.0, FloodNet v2 and flood-detector-api v1.1.0');

  // 7) AI analyses (best effort — skipped gracefully if service is down).
  if (await aiServiceUp()) {
    const all = await prisma.artifact.findMany({ select: { chainId: true } });
    for (const a of all) {
      try {
        await runAnalysis(a.chainId);
      } catch {
        /* individual analysis failure is non-fatal for demo load */
      }
    }
    log.push('AI risk analysis executed for all demo artifacts');
  } else {
    log.push('AI service offline — analyses skipped (start it with `npm run ai`)');
  }

  return { log, artifactCount: await prisma.artifact.count() };
}

/** Rewrite the stored bytes of the tamper target — a real storage-level attack. */
export async function simulateIntegrityViolation() {
  const target = await prisma.artifact.findFirst({ where: { name: TAMPER_TARGET } });
  if (!target) throw notFound('Load the demo data first — the tamper target is not registered.');
  const metadata = await ipfsService.getJson<ArtifactMetadataDoc>(target.metadataCid);
  const fileRef = metadata?.files?.find((f) => f.path === 'calibration.csv') ?? metadata?.files?.[0];
  if (!fileRef) throw notFound('Stored files for the tamper target are unavailable.');
  const objectPath = ipfsService.localObjectPath(fileRef.cid);
  if (!objectPath || !fs.existsSync(objectPath)) {
    throw badRequest('Integrity-violation simulation requires local storage mode.');
  }

  const backup = `${objectPath}.orig`;
  if (!fs.existsSync(backup)) fs.copyFileSync(objectPath, backup);
  fs.writeFileSync(
    objectPath,
    text(
      `sensor_id,offset,scale\nS-001,0.02,1.001\nS-002,-0.01,0.998\nS-003,0.40,1.310\nS-004,0.05,1.012\n`
    )
  );

  return {
    tampered: true,
    artifactChainId: target.chainId,
    file: fileRef.path,
    note: 'Stored bytes of calibration.csv were modified. The on-chain commitment is unchanged — run verification to detect the mismatch.',
  };
}

/** Run the headline verification demo: one intact artifact, one tampered. */
export async function runVerificationDemo() {
  const [intact, tamperTarget] = await Promise.all([
    prisma.artifact.findFirst({ where: { name: DEMO_MARKER, version: 'v1.0' } }),
    prisma.artifact.findFirst({ where: { name: TAMPER_TARGET } }),
  ]);
  if (!intact || !tamperTarget) throw notFound('Load the demo data first.');
  const intactResult = await verifyStoredCopy(intact.chainId);
  const tamperResult = await verifyStoredCopy(tamperTarget.chainId);
  return { intact: intactResult, tamperTarget: tamperResult };
}

/**
 * Full reset: restore tampered objects, deploy a FRESH registry contract
 * (a genuinely empty ledger — history on the old contract remains on the
 * dev chain, as immutability demands), and clear the database index.
 */
export async function resetDemo() {
  // Restore any tampered stored objects from backups.
  const restoreDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) restoreDir(full);
      else if (entry.name.endsWith('.orig')) {
        fs.copyFileSync(full, full.slice(0, -'.orig'.length));
        fs.unlinkSync(full);
      }
    }
  };
  const { STORAGE_DIR } = await import('../config.js');
  restoreDir(STORAGE_DIR);

  const deployment = await redeployRegistry();

  await prisma.$transaction([
    prisma.aiAnalysis.deleteMany(),
    prisma.verificationEvent.deleteMany(),
    prisma.provenanceEvent.deleteMany(),
    prisma.blockchainTransaction.deleteMany(),
    prisma.preparedUpload.deleteMany(),
    prisma.artifact.deleteMany(),
    prisma.indexerState.deleteMany(),
  ]);

  return {
    reset: true,
    newContractAddress: deployment.contractAddress,
    deployBlock: deployment.deployBlock,
    note: 'Fresh registry deployed; database index cleared; tampered objects restored.',
  };
}
