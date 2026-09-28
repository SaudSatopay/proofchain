/**
 * Event indexer: replays ProofChainRegistry events into the database so
 * the app has fast queries while the chain stays the source of truth.
 * The whole index can be rebuilt from block `deployBlock` at any time —
 * that property is what makes the database an index, not a ledger.
 */
import type { EventLog } from 'ethers';
import { prisma } from '../db.js';
import { getDeployment, isChainUp, provider, registry } from './chain.js';
import { indexArtifactFromChain } from './artifacts.js';

const POLL_MS = 4000;
let running = false;
let timer: NodeJS.Timeout | null = null;

async function recordTransaction(log: EventLog, method: string, artifactChainId: number | null) {
  const existing = await prisma.blockchainTransaction.findUnique({
    where: { txHash: log.transactionHash },
  });
  if (existing) {
    if (artifactChainId && !existing.artifactChainId) {
      await prisma.blockchainTransaction.update({
        where: { txHash: log.transactionHash },
        data: { artifactChainId, method },
      });
    }
    return;
  }
  const [receipt, block] = await Promise.all([
    provider.getTransactionReceipt(log.transactionHash),
    provider.getBlock(log.blockNumber),
  ]);
  const deployment = getDeployment();
  await prisma.blockchainTransaction.create({
    data: {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      fromAddress: receipt?.from ?? '',
      toAddress: receipt?.to ?? deployment?.contractAddress ?? null,
      method,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      gasUsed: receipt?.gasUsed?.toString() ?? null,
      artifactChainId,
      network: deployment?.network ?? 'localhost',
      blockTimestamp: block ? new Date(block.timestamp * 1000) : null,
    },
  });
}

async function recordProvenance(
  type: string,
  artifactChainId: number,
  log: EventLog,
  data: Record<string, unknown>
) {
  const existing = await prisma.provenanceEvent.findFirst({
    where: { type, artifactChainId, txHash: log.transactionHash },
  });
  if (existing) return;
  await prisma.provenanceEvent.create({
    data: {
      type,
      artifactChainId,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      dataJson: JSON.stringify(data),
    },
  });
}

async function indexRange(fromBlock: number, toBlock: number) {
  const contract = registry();

  const [registered, versions, transfers, revocations] = await Promise.all([
    contract.queryFilter(contract.filters.ArtifactRegistered(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.ArtifactVersionCreated(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.ArtifactOwnershipTransferred(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.ArtifactRevoked(), fromBlock, toBlock),
  ]);

  // Registrations first (they create index rows), in chain order.
  for (const log of registered as EventLog[]) {
    const artifactId = Number(log.args.artifactId);
    await indexArtifactFromChain(artifactId, {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      gasUsed: null,
    });
    await recordTransaction(log, 'registerArtifact', artifactId);
    await recordProvenance('ARTIFACT_REGISTERED', artifactId, log, {
      name: String(log.args.name),
      version: String(log.args.version),
      artifactType: String(log.args.artifactType),
      owner: String(log.args.owner),
      artifactHash: String(log.args.artifactHash),
      parentArtifactId: Number(log.args.parentArtifactId),
    });
    // Backfill gasUsed on the artifact row.
    const receipt = await provider.getTransactionReceipt(log.transactionHash);
    if (receipt) {
      await prisma.artifact.update({
        where: { chainId: artifactId },
        data: { gasUsed: receipt.gasUsed.toString() },
      });
    }
  }

  for (const log of versions as EventLog[]) {
    const newId = Number(log.args.newArtifactId);
    await recordTransaction(log, 'updateArtifactVersion', newId);
    await recordProvenance('VERSION_CREATED', newId, log, {
      parentArtifactId: Number(log.args.parentArtifactId),
      newVersion: String(log.args.newVersion),
      newHash: String(log.args.newHash),
    });
  }

  for (const log of transfers as EventLog[]) {
    const artifactId = Number(log.args.artifactId);
    await indexArtifactFromChain(artifactId, null); // refresh owner
    await recordTransaction(log, 'transferArtifactOwnership', artifactId);
    await recordProvenance('OWNERSHIP_TRANSFERRED', artifactId, log, {
      previousOwner: String(log.args.previousOwner),
      newOwner: String(log.args.newOwner),
    });
  }

  for (const log of revocations as EventLog[]) {
    const artifactId = Number(log.args.artifactId);
    await indexArtifactFromChain(artifactId, null); // refresh active flag
    await recordTransaction(log, 'revokeArtifact', artifactId);
    await recordProvenance('ARTIFACT_REVOKED', artifactId, log, {
      owner: String(log.args.owner),
    });
  }
}

async function tick() {
  const deployment = getDeployment();
  if (!deployment || !(await isChainUp())) return;

  const latest = await provider.getBlockNumber();
  const bookmark = await prisma.indexerState.findUnique({ where: { id: 1 } });

  // A different contract address means a fresh registry (demo reset or
  // redeploy) — start indexing from its deploy block again.
  const fromBlock =
    bookmark && bookmark.contractAddress === deployment.contractAddress
      ? bookmark.lastBlock + 1
      : deployment.deployBlock;

  if (fromBlock > latest) return;

  await indexRange(fromBlock, latest);

  await prisma.indexerState.upsert({
    where: { id: 1 },
    update: { lastBlock: latest, contractAddress: deployment.contractAddress },
    create: { id: 1, lastBlock: latest, contractAddress: deployment.contractAddress },
  });
}

export function startIndexer() {
  if (timer) return;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.warn('[indexer]', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  timer = setInterval(loop, POLL_MS);
  void loop();
  console.log(`[indexer] polling chain every ${POLL_MS}ms`);
}

export function stopIndexer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Force a synchronous catch-up (used after server-side transactions). */
export async function indexNow(): Promise<void> {
  try {
    await tick();
  } catch (err) {
    console.warn('[indexer] on-demand tick failed:', err instanceof Error ? err.message : err);
  }
}
