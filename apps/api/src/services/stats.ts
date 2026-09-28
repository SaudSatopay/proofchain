/**
 * Dashboard statistics — computed from real indexed data only. When the
 * database is empty the numbers are zero and the UI shows proper empty
 * states; nothing here is fabricated.
 */
import type { DashboardStats } from '@proofchain/types';
import { parseJson, prisma } from '../db.js';
import { isChainUp, provider } from './chain.js';

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function dashboardStats(): Promise<DashboardStats> {
  const [artifacts, verifications, txCount, analyses, recentEvents] = await Promise.all([
    prisma.artifact.findMany({
      select: { chainId: true, artifactType: true, registeredAt: true, parentChainId: true, name: true },
    }),
    prisma.verificationEvent.findMany({
      select: { matched: true, createdAt: true, artifactChainId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.blockchainTransaction.count(),
    prisma.aiAnalysis.findMany({
      select: { artifactChainId: true, riskLevel: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.provenanceEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ]);

  // Latest analysis per artifact decides its current risk bucket.
  const latestRisk = new Map<number, string>();
  for (const a of analyses) latestRisk.set(a.artifactChainId, a.riskLevel);
  const riskDistribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const level of latestRisk.values()) {
    if (level in riskDistribution) riskDistribution[level as keyof typeof riskDistribution]++;
  }

  const byType = { DATASET: 0, MODEL: 0, SOFTWARE: 0 };
  for (const a of artifacts) {
    if (a.artifactType in byType) byType[a.artifactType as keyof typeof byType]++;
  }

  const verifiedIds = new Set(
    verifications.filter((v) => v.matched && v.artifactChainId).map((v) => v.artifactChainId)
  );
  const violations = verifications.filter((v) => !v.matched).length;

  // Time series over the last 14 days.
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const verificationActivity = days.map((date) => ({ date, passed: 0, failed: 0 }));
  for (const v of verifications) {
    const idx = days.indexOf(dayKey(v.createdAt));
    if (idx >= 0) (v.matched ? verificationActivity[idx].passed++ : verificationActivity[idx].failed++);
  }
  const versionActivity = days.map((date) => ({ date, registered: 0, versions: 0 }));
  for (const a of artifacts) {
    const idx = days.indexOf(dayKey(a.registeredAt));
    if (idx >= 0) (a.parentChainId ? versionActivity[idx].versions++ : versionActivity[idx].registered++);
  }

  // Real chain activity: last blocks with their tx counts.
  const blockActivity: DashboardStats['blockActivity'] = [];
  if (await isChainUp()) {
    try {
      const latest = await provider.getBlockNumber();
      const from = Math.max(0, latest - 11);
      for (let n = from; n <= latest; n++) {
        const block = await provider.getBlock(n);
        if (block) {
          blockActivity.push({
            blockNumber: n,
            txCount: block.transactions.length,
            timestamp: new Date(block.timestamp * 1000).toISOString(),
          });
        }
      }
    } catch {
      // chain went down mid-query — leave partial data
    }
  }

  const namesByChainId = new Map(artifacts.map((a) => [a.chainId, a.name]));

  return {
    totalArtifacts: artifacts.length,
    verifiedArtifacts: verifiedIds.size,
    integrityViolations: violations,
    blockchainTransactions: txCount,
    highRiskArtifacts: riskDistribution.HIGH + riskDistribution.CRITICAL,
    byType,
    riskDistribution,
    verificationActivity,
    blockActivity,
    versionActivity,
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      type: e.type as DashboardStats['recentEvents'][number]['type'],
      artifactChainId: e.artifactChainId,
      artifactName: e.artifactChainId ? namesByChainId.get(e.artifactChainId) ?? null : null,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      data: parseJson(e.dataJson, {}),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
