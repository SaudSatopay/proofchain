/**
 * Verification: recompute a fingerprint from supplied bytes and compare it
 * against the on-chain commitment. The comparison is always made against
 * the BLOCKCHAIN (verifyArtifact / getArtifact), never against database
 * values alone — the database only enriches the report.
 */
import { fingerprintFiles, toBytes32, type FileInput, type ManifestEntry, diffManifests } from '@proofchain/crypto';
import type { VerificationResult } from '@proofchain/types';
import { parseJson, prisma } from '../db.js';
import { notFound } from '../errors.js';
import { getArtifactFromChain, getDeployment, verifyHashOnChain } from './chain.js';
import { ipfsService } from './storage.js';
import { toArtifactRecord, type ArtifactMetadataDoc } from './artifacts.js';

interface VerifyOptions {
  targetChainId?: number | null;
  fileName?: string;
}

interface RegisteredManifest {
  files: ManifestEntry[];
}

async function loadManifest(manifestCid: string | null): Promise<ManifestEntry[] | null> {
  if (!manifestCid) return null;
  const doc = await ipfsService.getJson<RegisteredManifest>(manifestCid);
  return doc?.files ?? null;
}

/** Find the most plausible original among registered artifacts by comparing manifests. */
async function findCandidateByManifest(current: ManifestEntry[]): Promise<number | null> {
  const artifacts = await prisma.artifact.findMany({
    where: { manifestCid: { not: null } },
    select: { chainId: true, manifestCid: true },
    take: 200,
  });
  const currentPaths = new Set(current.map((e) => e.path));
  let best: { chainId: number; score: number } | null = null;
  for (const artifact of artifacts) {
    const registered = await loadManifest(artifact.manifestCid);
    if (!registered || registered.length === 0) continue;
    const registeredPaths = new Set(registered.map((e) => e.path));
    let shared = 0;
    for (const p of currentPaths) if (registeredPaths.has(p)) shared++;
    const union = new Set([...currentPaths, ...registeredPaths]).size;
    const score = union === 0 ? 0 : shared / union;
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { chainId: artifact.chainId, score };
    }
  }
  return best?.chainId ?? null;
}

async function recordVerification(
  matched: boolean,
  suppliedHash: string,
  registeredHash: string | null,
  method: 'SHA256' | 'MERKLE',
  fileName: string,
  fileCount: number,
  sizeBytes: number,
  artifactChainId: number | null,
  details: Record<string, unknown>
) {
  await prisma.verificationEvent.create({
    data: {
      artifactChainId,
      matched,
      suppliedHash,
      registeredHash,
      method,
      fileName,
      fileCount,
      sizeBytes,
      detailsJson: JSON.stringify(details),
    },
  });
  if (artifactChainId) {
    await prisma.provenanceEvent.create({
      data: {
        type: matched ? 'VERIFICATION_PASSED' : 'INTEGRITY_MISMATCH',
        artifactChainId,
        dataJson: JSON.stringify({ suppliedHash, registeredHash, fileName }),
      },
    });
  }
}

export async function verifyFiles(files: FileInput[], opts: VerifyOptions = {}): Promise<VerificationResult> {
  const fp = await fingerprintFiles(files);
  const suppliedHash = toBytes32(fp.artifactHash);
  const method: 'SHA256' | 'MERKLE' = fp.merkleRoot ? 'MERKLE' : 'SHA256';
  const fileName =
    opts.fileName ?? (files.length === 1 ? files[0].path : `${files.length} files`);
  const deployment = getDeployment();

  // 1) Ask the chain whether this exact fingerprint is committed.
  const chainCheck = await verifyHashOnChain(suppliedHash);

  if (chainCheck.exists) {
    // Fingerprint matches an on-chain commitment.
    let row = await prisma.artifact.findUnique({ where: { chainId: chainCheck.artifactId } });
    const targetMismatch =
      opts.targetChainId != null && opts.targetChainId !== chainCheck.artifactId;

    await recordVerification(
      !targetMismatch,
      suppliedHash,
      suppliedHash,
      method,
      fileName,
      files.length,
      fp.totalSize,
      chainCheck.artifactId,
      targetMismatch ? { note: 'matched a different artifact', target: opts.targetChainId } : {}
    );

    return {
      matched: !targetMismatch,
      artifact: row ? toArtifactRecord(row) : null,
      suppliedHash,
      registeredHash: suppliedHash,
      method,
      fileCount: files.length,
      sizeBytes: fp.totalSize,
      fileName,
      manifestDiff: null,
      chain: {
        verified: true,
        contractAddress: deployment?.contractAddress ?? '',
        network: deployment?.network ?? 'localhost',
        txHash: row?.txHash ?? null,
        blockNumber: row?.blockNumber ?? null,
        timestamp: chainCheck.timestamp ? new Date(chainCheck.timestamp * 1000).toISOString() : null,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  // 2) Not on chain. Compare against a specific artifact (explicit target,
  //    or the best manifest match) to explain WHAT changed.
  let targetChainId = opts.targetChainId ?? null;
  if (!targetChainId) {
    targetChainId = await findCandidateByManifest(fp.entries);
  }

  if (targetChainId) {
    const onChain = await getArtifactFromChain(targetChainId).catch(() => null);
    if (!onChain) throw notFound(`Artifact #${targetChainId} is not registered on-chain`);
    const row = await prisma.artifact.findUnique({ where: { chainId: targetChainId } });
    const registeredManifest = await loadManifest(row?.manifestCid ?? null);
    const manifestDiff = registeredManifest ? diffManifests(registeredManifest, fp.entries) : null;

    await recordVerification(
      false,
      suppliedHash,
      onChain.artifactHash,
      method,
      fileName,
      files.length,
      fp.totalSize,
      targetChainId,
      { manifestDiff }
    );

    return {
      matched: false,
      artifact: row ? toArtifactRecord(row) : null,
      suppliedHash,
      registeredHash: onChain.artifactHash,
      method,
      fileCount: files.length,
      sizeBytes: fp.totalSize,
      fileName,
      manifestDiff,
      chain: {
        verified: true,
        contractAddress: deployment?.contractAddress ?? '',
        network: deployment?.network ?? 'localhost',
        txHash: row?.txHash ?? null,
        blockNumber: row?.blockNumber ?? null,
        timestamp: new Date(onChain.timestamp * 1000).toISOString(),
      },
      checkedAt: new Date().toISOString(),
    };
  }

  // 3) Unknown fingerprint, no plausible original — record and report.
  await recordVerification(
    false,
    suppliedHash,
    null,
    method,
    fileName,
    files.length,
    fp.totalSize,
    null,
    { note: 'no registered artifact resembles this file set' }
  );

  return {
    matched: false,
    artifact: null,
    suppliedHash,
    registeredHash: null,
    method,
    fileCount: files.length,
    sizeBytes: fp.totalSize,
    fileName,
    manifestDiff: null,
    chain: deployment
      ? {
          verified: true,
          contractAddress: deployment.contractAddress,
          network: deployment.network,
          txHash: null,
          blockNumber: null,
          timestamp: null,
        }
      : null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Verify the STORED copy of an artifact against its on-chain commitment.
 * Reads every stored object back from storage, recomputes the fingerprint
 * and compares — this is how storage-level tampering is detected even when
 * nobody re-uploads the files.
 */
export async function verifyStoredCopy(chainId: number): Promise<VerificationResult> {
  const row = await prisma.artifact.findUnique({ where: { chainId } });
  if (!row) throw notFound(`Artifact #${chainId} is not registered`);
  const metadata = await ipfsService.getJson<ArtifactMetadataDoc>(row.metadataCid);
  if (!metadata || metadata.files.length === 0) {
    throw notFound('Stored file objects for this artifact are unavailable');
  }
  const files: FileInput[] = [];
  for (const ref of metadata.files) {
    const bytes = await ipfsService.getObject(ref.cid);
    if (!bytes) throw notFound(`Stored object missing for ${ref.path}`);
    files.push({ path: ref.path, bytes });
  }
  return verifyFiles(files, { targetChainId: chainId, fileName: `${row.name} (stored copy)` });
}

export function verificationHistory(limit = 50) {
  return prisma.verificationEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export { parseJson };
