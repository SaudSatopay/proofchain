/**
 * Artifact lifecycle: prepare (hash + store) → commit on-chain → index.
 *
 * Two-phase design keeps the chain authoritative: the API never marks an
 * artifact as registered until the transaction is confirmed and the
 * ArtifactRegistered event has been read back from the node.
 */
import type { Artifact as ArtifactRow } from '@prisma/client';
import { fingerprintFiles, toBytes32, type FileInput } from '@proofchain/crypto';
import type {
  ArtifactRecord,
  ArtifactType,
  StorageMode,
  TypeSpecificFields,
} from '@proofchain/types';
import { env } from '../config.js';
import { parseJson, prisma } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import {
  getArtifactFromChain,
  getDeployment,
  provider,
  registryAsServer,
  decodeRegistration,
  resetServerNonce,
  verifyHashOnChain,
} from './chain.js';
import { ipfsService } from './storage.js';

export interface StoredFileRef {
  path: string;
  sha256: string;
  size: number;
  cid: string;
}

export interface ArtifactMetadataDoc {
  schema: 'proofchain/artifact-metadata@1';
  artifactType: ArtifactType;
  name: string;
  description: string;
  version: string;
  creator: string;
  fields: TypeSpecificFields;
  artifactHash: string;
  merkleRoot: string | null;
  manifestCid: string;
  files: StoredFileRef[];
  totalSize: number;
  createdAt: string;
}

export interface PreparedSummary {
  preparedId: string;
  artifactHash: string;
  merkleRoot: string | null;
  metadataCid: string;
  manifestCid: string;
  fileCount: number;
  sizeBytes: number;
  storageMode: StorageMode;
  merkleLayers: number[] | null;
  duplicate: { exists: boolean; artifactId: number };
  files: { path: string; sha256: string; size: number }[];
}

export interface RegistrationPayload {
  artifactType: ArtifactType;
  name: string;
  description: string;
  version: string;
  creator: string;
  fields: TypeSpecificFields;
  parentChainId: number | null;
  asVersion: boolean;
}

// ── Prepare ────────────────────────────────────────────────

export async function prepareUpload(
  files: FileInput[],
  payload: RegistrationPayload,
  userId: string | null
): Promise<PreparedSummary> {
  if (files.length === 0) throw badRequest('At least one file is required');
  if (files.length > env.MAX_FILES_PER_ARTIFACT) {
    throw badRequest(`Too many files (max ${env.MAX_FILES_PER_ARTIFACT})`);
  }

  const fp = await fingerprintFiles(files);
  const artifactHash = toBytes32(fp.artifactHash);

  // Store each file, the canonical manifest, and the metadata document.
  const storedFiles: StoredFileRef[] = [];
  for (const file of files) {
    const entry = fp.entries.find((e) => e.path === file.path.replace(/\\/g, '/').replace(/^\.\//, ''));
    const stored = await ipfsService.putObject(file.bytes, file.path);
    storedFiles.push({
      path: entry?.path ?? file.path,
      sha256: entry?.sha256 ?? '',
      size: file.bytes.byteLength,
      cid: stored.cid,
    });
  }
  storedFiles.sort((a, b) => (a.path < b.path ? -1 : 1));

  const manifestStored = await ipfsService.putObject(
    new TextEncoder().encode(fp.manifestJson),
    'manifest.json'
  );

  const metadataDoc: ArtifactMetadataDoc = {
    schema: 'proofchain/artifact-metadata@1',
    artifactType: payload.artifactType,
    name: payload.name,
    description: payload.description,
    version: payload.version,
    creator: payload.creator,
    fields: payload.fields,
    artifactHash,
    merkleRoot: fp.merkleRoot,
    manifestCid: manifestStored.cid,
    files: storedFiles,
    totalSize: fp.totalSize,
    createdAt: new Date().toISOString(),
  };
  const metadataStored = await ipfsService.putJson(metadataDoc, 'metadata.json');

  // Warn about duplicates before any transaction is attempted.
  let duplicate = { exists: false, artifactId: 0 };
  try {
    const check = await verifyHashOnChain(artifactHash);
    duplicate = { exists: check.exists, artifactId: check.artifactId };
  } catch {
    // Chain down — duplicate check happens again at registration time.
  }

  const prepared = await prisma.preparedUpload.create({
    data: {
      artifactHash,
      merkleRoot: fp.merkleRoot,
      metadataCid: metadataStored.cid,
      manifestCid: manifestStored.cid,
      fileCount: files.length,
      sizeBytes: fp.totalSize,
      payloadJson: JSON.stringify(payload),
      createdById: userId,
    },
  });

  return {
    preparedId: prepared.id,
    artifactHash,
    merkleRoot: fp.merkleRoot,
    metadataCid: metadataStored.cid,
    manifestCid: manifestStored.cid,
    fileCount: files.length,
    sizeBytes: fp.totalSize,
    storageMode: ipfsService.mode(),
    merkleLayers: fp.tree ? fp.tree.layers.map((l) => l.length) : null,
    duplicate,
    files: fp.entries.map((e) => ({ path: e.path, sha256: e.sha256, size: e.size })),
  };
}

async function loadPrepared(preparedId: string) {
  const prepared = await prisma.preparedUpload.findUnique({ where: { id: preparedId } });
  if (!prepared) throw notFound('Prepared upload not found — hash the files again');
  if (prepared.consumedAt) throw badRequest('This prepared upload was already registered');
  return prepared;
}

// ── Commit on-chain (server dev signer) ────────────────────

export async function registerServerSide(preparedId: string): Promise<ArtifactRecord> {
  const prepared = await loadPrepared(preparedId);
  const payload = JSON.parse(prepared.payloadJson) as RegistrationPayload;
  const contract = registryAsServer();

  let tx;
  try {
    if (payload.asVersion && payload.parentChainId) {
      tx = await contract.updateArtifactVersion(
        payload.parentChainId,
        payload.version,
        prepared.artifactHash,
        prepared.metadataCid
      );
    } else {
      tx = await contract.registerArtifact(
        payload.artifactType,
        payload.name,
        payload.version,
        prepared.artifactHash,
        prepared.metadataCid,
        payload.parentChainId ?? 0
      );
    }
  } catch (err) {
    throw translateChainError(err);
  }

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new AppError(502, 'TX_FAILED', 'The blockchain transaction was mined but reverted.');
  }
  const registration = decodeRegistration(receipt);
  if (!registration) {
    throw new AppError(502, 'EVENT_MISSING', 'Transaction confirmed but no ArtifactRegistered event was found.');
  }

  await prisma.preparedUpload.update({
    where: { id: prepared.id },
    data: { consumedAt: new Date() },
  });

  const row = await indexArtifactFromChain(registration.artifactId, {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed?.toString() ?? null,
  });
  return toArtifactRecord(row);
}

/** Confirm a transaction the user signed with their own wallet. */
export async function confirmClientTx(preparedId: string, txHash: string): Promise<ArtifactRecord> {
  const prepared = await loadPrepared(preparedId);

  const receipt = await provider.waitForTransaction(txHash, 1, 90_000);
  if (!receipt) throw new AppError(504, 'TX_TIMEOUT', 'Transaction was not confirmed within 90 seconds.');
  if (receipt.status !== 1) throw new AppError(502, 'TX_FAILED', 'The transaction reverted on-chain.');

  const registration = decodeRegistration(receipt);
  if (!registration) {
    throw badRequest('This transaction does not contain a ProofChain registration event.');
  }
  if (registration.artifactHash !== prepared.artifactHash.toLowerCase()) {
    throw badRequest(
      'The on-chain fingerprint does not match the prepared upload. Register the exact files you hashed.'
    );
  }

  await prisma.preparedUpload.update({
    where: { id: prepared.id },
    data: { consumedAt: new Date() },
  });

  const row = await indexArtifactFromChain(registration.artifactId, {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed?.toString() ?? null,
  });
  return toArtifactRecord(row);
}

// ── Ownership / revocation (server signer path) ────────────

export async function transferServerSide(chainId: number, newOwner: string): Promise<ArtifactRecord> {
  const contract = registryAsServer();
  try {
    const tx = await contract.transferArtifactOwnership(chainId, newOwner);
    await tx.wait();
  } catch (err) {
    throw translateChainError(err);
  }
  const row = await indexArtifactFromChain(chainId, null);
  return toArtifactRecord(row);
}

export async function revokeServerSide(chainId: number): Promise<ArtifactRecord> {
  const contract = registryAsServer();
  try {
    const tx = await contract.revokeArtifact(chainId);
    await tx.wait();
  } catch (err) {
    throw translateChainError(err);
  }
  const row = await indexArtifactFromChain(chainId, null);
  return toArtifactRecord(row);
}

function translateChainError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('nonce has already been used') || message.includes('invalid nonce')) {
    resetServerNonce();
    return new AppError(409, 'NONCE_CONFLICT', 'Transaction nonce conflict — the signer state was re-synced, retry the operation.');
  }
  if (message.includes('DuplicateArtifactHash')) {
    return badRequest('This exact fingerprint is already registered on-chain (duplicate artifact).');
  }
  if (message.includes('NotArtifactOwner')) {
    return new AppError(403, 'NOT_CHAIN_OWNER', 'The signing wallet does not own this artifact on-chain.');
  }
  if (message.includes('ArtifactNotActive')) {
    return badRequest('This artifact has been revoked — no further on-chain operations are possible.');
  }
  if (message.includes('insufficient funds')) {
    return new AppError(402, 'INSUFFICIENT_FUNDS', 'The signing account has insufficient funds for gas.');
  }
  if (message.includes('ECONNREFUSED') || message.includes('failed to detect network')) {
    return new AppError(503, 'CHAIN_UNAVAILABLE', 'The blockchain node is unreachable. Start it with `npm run chain`.');
  }
  return new AppError(502, 'CHAIN_ERROR', `Blockchain operation failed: ${message.slice(0, 200)}`);
}

// ── Indexing (chain → database) ────────────────────────────

interface TxMeta {
  txHash: string;
  blockNumber: number;
  gasUsed: string | null;
}

/**
 * Pull one artifact from the chain and upsert its database index row.
 * Idempotent — used by the registration flows and the event indexer.
 */
export async function indexArtifactFromChain(
  chainArtifactId: number,
  txMeta: TxMeta | null
): Promise<ArtifactRow> {
  const onChain = await getArtifactFromChain(chainArtifactId);
  const deployment = getDeployment();

  // Enrich with the off-chain metadata document (description, fields, files).
  const metadata = await ipfsService.getJson<ArtifactMetadataDoc>(onChain.metadataCID);

  // Root of the lineage tree — parent rows exist because chain ids are
  // assigned (and therefore indexed) in causal order.
  let rootChainId = onChain.id;
  if (onChain.parentArtifactId !== 0) {
    const parentRow = await prisma.artifact.findUnique({
      where: { chainId: onChain.parentArtifactId },
    });
    rootChainId = parentRow?.rootChainId ?? onChain.parentArtifactId;
  }

  const existing = await prisma.artifact.findUnique({ where: { chainId: onChain.id } });

  const data = {
    artifactType: (metadata?.artifactType ?? onChain.artifactType) as string,
    name: onChain.name,
    description: metadata?.description ?? existing?.description ?? '',
    version: onChain.version,
    creator: metadata?.creator ?? existing?.creator ?? '',
    fieldsJson: JSON.stringify(metadata?.fields ?? parseJson(existing?.fieldsJson, {})),
    artifactHash: onChain.artifactHash,
    merkleRoot: metadata?.merkleRoot ?? existing?.merkleRoot ?? null,
    fileCount: metadata?.files?.length ?? existing?.fileCount ?? 1,
    sizeBytes: metadata?.totalSize ?? existing?.sizeBytes ?? 0,
    metadataCid: onChain.metadataCID,
    manifestCid: metadata?.manifestCid ?? existing?.manifestCid ?? null,
    storageMode: onChain.metadataCID.startsWith('local:') ? 'local' : 'pinata',
    ownerAddress: onChain.owner,
    parentChainId: onChain.parentArtifactId === 0 ? null : onChain.parentArtifactId,
    rootChainId,
    active: onChain.active,
    network: deployment?.network ?? env.NETWORK_NAME,
    contractAddress: deployment?.contractAddress ?? '',
    registeredAt: new Date(onChain.timestamp * 1000),
    ...(txMeta
      ? { txHash: txMeta.txHash, blockNumber: txMeta.blockNumber, gasUsed: txMeta.gasUsed }
      : {}),
  };

  if (existing) {
    return prisma.artifact.update({ where: { chainId: onChain.id }, data });
  }
  return prisma.artifact.create({
    data: {
      chainId: onChain.id,
      txHash: txMeta?.txHash ?? '',
      blockNumber: txMeta?.blockNumber ?? 0,
      gasUsed: txMeta?.gasUsed ?? null,
      ...data,
    },
  });
}

// ── DTO mapping / queries ──────────────────────────────────

export function toArtifactRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    chainId: row.chainId,
    artifactType: row.artifactType as ArtifactType,
    name: row.name,
    description: row.description,
    version: row.version,
    creator: row.creator,
    fields: parseJson<TypeSpecificFields>(row.fieldsJson, {}),
    artifactHash: row.artifactHash,
    merkleRoot: row.merkleRoot,
    fileCount: row.fileCount,
    sizeBytes: row.sizeBytes,
    metadataCid: row.metadataCid,
    storageMode: row.storageMode as StorageMode,
    ownerAddress: row.ownerAddress,
    parentChainId: row.parentChainId,
    rootChainId: row.rootChainId,
    active: row.active,
    network: row.network,
    contractAddress: row.contractAddress,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    gasUsed: row.gasUsed,
    registeredAt: row.registeredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getArtifactDetail(chainId: number) {
  const row = await prisma.artifact.findUnique({ where: { chainId } });
  if (!row) {
    // The chain may know it even if the index is cold — try once.
    try {
      const indexed = await indexArtifactFromChain(chainId, null);
      return buildDetail(indexed);
    } catch {
      throw notFound(`Artifact #${chainId} is not registered`);
    }
  }
  return buildDetail(row);
}

async function buildDetail(row: ArtifactRow) {
  const [family, verifications, analyses, transactions, events] = await Promise.all([
    prisma.artifact.findMany({ where: { rootChainId: row.rootChainId }, orderBy: { chainId: 'asc' } }),
    prisma.verificationEvent.findMany({
      where: { artifactChainId: row.chainId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.aiAnalysis.findMany({
      where: { artifactChainId: row.chainId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.blockchainTransaction.findMany({
      where: { artifactChainId: row.chainId },
      orderBy: { blockNumber: 'desc' },
    }),
    prisma.provenanceEvent.findMany({
      where: { artifactChainId: row.chainId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const lineage = buildLineage(row, family);
  const metadata = await ipfsService.getJson<ArtifactMetadataDoc>(row.metadataCid);

  return {
    artifact: toArtifactRecord(row),
    lineage: lineage.map(toArtifactRecord),
    children: family.filter((a) => a.parentChainId === row.chainId).map(toArtifactRecord),
    files: metadata?.files ?? [],
    manifestCid: row.manifestCid,
    gatewayUrl: ipfsService.gatewayUrl(row.metadataCid),
    storageLabel: row.storageMode === 'local' ? 'Local Development Storage' : 'IPFS',
    verifications: verifications.map((v) => ({
      id: v.id,
      matched: v.matched,
      suppliedHash: v.suppliedHash,
      registeredHash: v.registeredHash,
      method: v.method,
      fileName: v.fileName,
      createdAt: v.createdAt.toISOString(),
    })),
    analyses: analyses.map(toAnalysisDto),
    transactions,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      data: parseJson(e.dataJson, {}),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

function buildLineage(row: ArtifactRow, family: ArtifactRow[]): ArtifactRow[] {
  const byChainId = new Map(family.map((a) => [a.chainId, a]));
  const chain: ArtifactRow[] = [];
  let cursor: ArtifactRow | undefined = row;
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentChainId ? byChainId.get(cursor.parentChainId) : undefined;
  }
  return chain;
}

export function toAnalysisDto(a: {
  riskScore: number;
  riskLevel: string;
  anomaliesJson: string;
  explanationJson: string;
  modelVersion: string;
  mode: string;
  sampleCount: number;
  featureCount: number;
  createdAt: Date;
}) {
  return {
    riskScore: a.riskScore,
    riskLevel: a.riskLevel,
    anomalies: parseJson(a.anomaliesJson, []),
    explanation: parseJson(a.explanationJson, []),
    modelVersion: a.modelVersion,
    mode: a.mode,
    sampleCount: a.sampleCount,
    featureCount: a.featureCount,
    analyzedAt: a.createdAt.toISOString(),
  };
}

/** Provenance graph for the whole lineage family of an artifact. */
export async function provenanceGraph(chainId: number) {
  const row = await prisma.artifact.findUnique({ where: { chainId } });
  if (!row) throw notFound(`Artifact #${chainId} is not registered`);
  const family = await prisma.artifact.findMany({
    where: { rootChainId: row.rootChainId },
    orderBy: { chainId: 'asc' },
  });
  const latestAnalyses = await prisma.aiAnalysis.findMany({
    where: { artifactChainId: { in: family.map((a) => a.chainId) } },
    orderBy: { createdAt: 'asc' },
  });
  const riskByChainId = new Map<number, string>();
  for (const a of latestAnalyses) riskByChainId.set(a.artifactChainId, a.riskLevel);

  const nodes = family.map((a) => ({
    chainId: a.chainId,
    name: a.name,
    artifactType: a.artifactType,
    version: a.version,
    artifactHash: a.artifactHash,
    ownerAddress: a.ownerAddress,
    registeredAt: a.registeredAt.toISOString(),
    active: a.active,
    riskLevel: riskByChainId.get(a.chainId) ?? null,
    focus: a.chainId === chainId,
  }));

  const byChainId = new Map(family.map((a) => [a.chainId, a]));
  const edges = family
    .filter((a) => a.parentChainId && byChainId.has(a.parentChainId))
    .map((a) => {
      const parent = byChainId.get(a.parentChainId!)!;
      const isVersion = parent.name === a.name && parent.artifactType === a.artifactType;
      return {
        from: a.parentChainId!,
        to: a.chainId,
        kind: isVersion ? ('version' as const) : ('derived' as const),
      };
    });

  return { nodes, edges };
}
