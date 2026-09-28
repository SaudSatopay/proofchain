/**
 * Client for the Python anomaly-analysis service. The API assembles
 * honest historical records (lineage, verification outcomes, ownership
 * changes) and the FastAPI service owns feature engineering + the model.
 * If the service is down, analysis is reported as unavailable — never
 * faked.
 */
import type { AiAnalysisResult } from '@proofchain/types';
import { env } from '../config.js';
import { parseJson, prisma } from '../db.js';
import { AppError, notFound } from '../errors.js';
import { toAnalysisDto } from './artifacts.js';

export interface AiArtifactRecord {
  chainId: number;
  artifactType: string;
  sizeBytes: number;
  fileCount: number;
  registeredAt: string;
  versionIndex: number;
  versionCount: number;
  lineage: { version: string; sizeBytes: number; registeredAt: string }[];
  ownershipTransfers: number;
  verificationCount: number;
  verificationFailures: number;
  active: boolean;
}

async function buildRecords(): Promise<Map<number, AiArtifactRecord>> {
  const [artifacts, transfers, verifications] = await Promise.all([
    prisma.artifact.findMany({ orderBy: { chainId: 'asc' } }),
    prisma.provenanceEvent.findMany({ where: { type: 'OWNERSHIP_TRANSFERRED' } }),
    prisma.verificationEvent.findMany({ select: { artifactChainId: true, matched: true } }),
  ]);

  const transfersByArtifact = new Map<number, number>();
  for (const t of transfers) {
    if (t.artifactChainId == null) continue;
    transfersByArtifact.set(t.artifactChainId, (transfersByArtifact.get(t.artifactChainId) ?? 0) + 1);
  }
  const verifByArtifact = new Map<number, { total: number; failed: number }>();
  for (const v of verifications) {
    if (v.artifactChainId == null) continue;
    const entry = verifByArtifact.get(v.artifactChainId) ?? { total: 0, failed: 0 };
    entry.total++;
    if (!v.matched) entry.failed++;
    verifByArtifact.set(v.artifactChainId, entry);
  }

  // Group lineages by root to compute version ordering.
  const byRoot = new Map<number, typeof artifacts>();
  for (const a of artifacts) {
    const list = byRoot.get(a.rootChainId) ?? [];
    list.push(a);
    byRoot.set(a.rootChainId, list);
  }

  const records = new Map<number, AiArtifactRecord>();
  for (const a of artifacts) {
    const family = byRoot.get(a.rootChainId) ?? [a];
    // Version chain = same name+type within the family, ordered by chainId.
    const versionChain = family
      .filter((f) => f.name === a.name && f.artifactType === a.artifactType)
      .sort((x, y) => x.chainId - y.chainId);
    const idx = versionChain.findIndex((f) => f.chainId === a.chainId);
    const verif = verifByArtifact.get(a.chainId) ?? { total: 0, failed: 0 };

    records.set(a.chainId, {
      chainId: a.chainId,
      artifactType: a.artifactType,
      sizeBytes: a.sizeBytes,
      fileCount: a.fileCount,
      registeredAt: a.registeredAt.toISOString(),
      versionIndex: idx < 0 ? 0 : idx,
      versionCount: versionChain.length,
      lineage: versionChain.map((f) => ({
        version: f.version,
        sizeBytes: f.sizeBytes,
        registeredAt: f.registeredAt.toISOString(),
      })),
      ownershipTransfers: transfersByArtifact.get(a.chainId) ?? 0,
      verificationCount: verif.total,
      verificationFailures: verif.failed,
      active: a.active,
    });
  }
  return records;
}

export async function aiServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runAnalysis(chainId: number): Promise<AiAnalysisResult> {
  const artifact = await prisma.artifact.findUnique({ where: { chainId } });
  if (!artifact) throw notFound(`Artifact #${chainId} is not registered`);

  const records = await buildRecords();
  const target = records.get(chainId);
  if (!target) throw notFound(`No indexed data for artifact #${chainId}`);
  const population = [...records.values()];

  let response: Response;
  try {
    response = await fetch(`${env.AI_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, population }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new AppError(
      503,
      'AI_UNAVAILABLE',
      'The AI analysis service is unreachable. Start it with `npm run ai` (FastAPI on port 8000).',
      err instanceof Error ? err.message : String(err)
    );
  }
  if (!response.ok) {
    throw new AppError(502, 'AI_ERROR', `AI service returned HTTP ${response.status}`);
  }

  const result = (await response.json()) as AiAnalysisResult;

  const saved = await prisma.aiAnalysis.create({
    data: {
      artifactChainId: chainId,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      anomaliesJson: JSON.stringify(result.anomalies ?? []),
      explanationJson: JSON.stringify(result.explanation ?? []),
      featuresJson: JSON.stringify(target),
      modelVersion: result.modelVersion,
      mode: result.mode,
      sampleCount: result.sampleCount ?? population.length,
      featureCount: result.featureCount ?? 0,
    },
  });

  return toAnalysisDto(saved) as AiAnalysisResult;
}

export async function latestAnalyses(chainIds: number[]) {
  if (chainIds.length === 0) return new Map<number, ReturnType<typeof toAnalysisDto>>();
  const rows = await prisma.aiAnalysis.findMany({
    where: { artifactChainId: { in: chainIds } },
    orderBy: { createdAt: 'asc' },
  });
  const map = new Map<number, ReturnType<typeof toAnalysisDto>>();
  for (const row of rows) map.set(row.artifactChainId, toAnalysisDto(row));
  return map;
}

export { parseJson };
