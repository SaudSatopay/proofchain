/**
 * Verify, blockchain explorer, network config, dashboard, AI and storage
 * routes — grouped because each is small.
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config.js';
import { parseJson, prisma } from '../db.js';
import { notFound } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getDeployment,
  isChainUp,
  provider,
  serverSignerAddress,
} from '../services/chain.js';
import { ipfsService } from '../services/storage.js';
import { verifyFiles, verificationHistory } from '../services/verify.js';
import { aiServiceUp, runAnalysis } from '../services/ai.js';
import { dashboardStats } from '../services/stats.js';
import {
  demoStatus,
  loadDemoData,
  resetDemo,
  runVerificationDemo,
  simulateIntegrityViolation,
} from '../services/demo.js';
import { toAnalysisDto } from '../services/artifacts.js';
import { filesFromRequest } from './artifacts.js';
import { aiLimiter, demoLimiter, verifyLimiter } from './limiters.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: env.MAX_FILES_PER_ARTIFACT },
});

// ── /api/verify ────────────────────────────────────────────

export const verifyRouter = Router();

verifyRouter.post('/', verifyLimiter, upload.array('files'), async (req, res, next) => {
  try {
    const target = req.body.targetChainId
      ? z.coerce.number().int().positive().parse(req.body.targetChainId)
      : null;
    const files = filesFromRequest(req as never);
    res.json(await verifyFiles(files, { targetChainId: target }));
  } catch (err) {
    next(err);
  }
});

verifyRouter.get('/history', async (_req, res, next) => {
  try {
    const rows = await verificationHistory(60);
    const chainIds = [...new Set(rows.map((r) => r.artifactChainId).filter((x): x is number => x != null))];
    const artifacts = await prisma.artifact.findMany({
      where: { chainId: { in: chainIds } },
      select: { chainId: true, name: true, version: true },
    });
    const names = new Map(artifacts.map((a) => [a.chainId, `${a.name} ${a.version}`]));
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        artifactChainId: r.artifactChainId,
        artifactLabel: r.artifactChainId ? names.get(r.artifactChainId) ?? null : null,
        matched: r.matched,
        suppliedHash: r.suppliedHash,
        registeredHash: r.registeredHash,
        method: r.method,
        fileName: r.fileName,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── /api/blockchain ────────────────────────────────────────

export const blockchainRouter = Router();

blockchainRouter.get('/status', async (_req, res) => {
  const deployment = getDeployment();
  const up = await isChainUp();
  let latestBlock: number | null = null;
  if (up) {
    try {
      latestBlock = await provider.getBlockNumber();
    } catch {
      latestBlock = null;
    }
  }
  res.json({
    chainUp: up,
    latestBlock,
    network: deployment?.network ?? env.NETWORK_NAME,
    chainId: deployment?.chainId ?? env.CHAIN_ID,
    contractAddress: deployment?.contractAddress ?? null,
    certificateAddress: deployment?.certificateAddress ?? null,
    deployBlock: deployment?.deployBlock ?? null,
  });
});

blockchainRouter.get('/blocks', async (req, res, next) => {
  try {
    if (!(await isChainUp())) return res.json({ blocks: [], chainUp: false });
    const limit = z.coerce.number().int().min(1).max(25).default(12).parse(req.query.limit ?? 12);
    const latest = await provider.getBlockNumber();
    const from = Math.max(0, latest - limit + 1);
    const blocks = [];
    for (let n = latest; n >= from; n--) {
      const block = await provider.getBlock(n);
      if (!block) continue;
      blocks.push({
        number: n,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: new Date(block.timestamp * 1000).toISOString(),
        txCount: block.transactions.length,
        txHashes: [...block.transactions],
        gasUsed: block.gasUsed.toString(),
      });
    }
    res.json({ blocks, chainUp: true, latestBlock: latest });
  } catch (err) {
    next(err);
  }
});

blockchainRouter.get('/transactions', async (req, res, next) => {
  try {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page ?? 1);
    const pageSize = 25;
    const [total, rows] = await Promise.all([
      prisma.blockchainTransaction.count(),
      prisma.blockchainTransaction.findMany({
        orderBy: [{ blockNumber: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ total, page, pageSize, items: rows });
  } catch (err) {
    next(err);
  }
});

blockchainRouter.get('/events', async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(200).default(60).parse(req.query.limit ?? 60);
    const rows = await prisma.provenanceEvent.findMany({
      where: { txHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const chainIds = [...new Set(rows.map((r) => r.artifactChainId).filter((x): x is number => x != null))];
    const artifacts = await prisma.artifact.findMany({
      where: { chainId: { in: chainIds } },
      select: { chainId: true, name: true, version: true },
    });
    const names = new Map(artifacts.map((a) => [a.chainId, `${a.name} ${a.version}`]));
    res.json({
      items: rows.map((e) => ({
        id: e.id,
        type: e.type,
        artifactChainId: e.artifactChainId,
        artifactLabel: e.artifactChainId ? names.get(e.artifactChainId) ?? null : null,
        txHash: e.txHash,
        blockNumber: e.blockNumber,
        data: parseJson(e.dataJson, {}),
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── /api/network ───────────────────────────────────────────

export const networkRouter = Router();

networkRouter.get('/config', async (_req, res) => {
  const deployment = getDeployment();
  const chainUp = await isChainUp();
  let latestBlock: number | null = null;
  if (chainUp) {
    try {
      latestBlock = await provider.getBlockNumber();
    } catch {
      latestBlock = null;
    }
  }
  res.json({
    network: deployment?.network ?? env.NETWORK_NAME,
    chainId: deployment?.chainId ?? env.CHAIN_ID,
    rpcUrl: env.RPC_URL,
    contractAddress: deployment?.contractAddress ?? null,
    certificateAddress: deployment?.certificateAddress ?? null,
    latestBlock,
    storageMode: ipfsService.mode(),
    aiServiceUp: await aiServiceUp(),
    chainUp,
    serverSignerAddress: serverSignerAddress(),
  });
});

// ── /api/dashboard ─────────────────────────────────────────

export const dashboardRouter = Router();

dashboardRouter.get('/stats', async (_req, res, next) => {
  try {
    res.json(await dashboardStats());
  } catch (err) {
    next(err);
  }
});

// ── /api/ai ────────────────────────────────────────────────

export const aiRouter = Router();

aiRouter.get('/status', async (_req, res) => {
  const up = await aiServiceUp();
  let info: unknown = null;
  if (up) {
    try {
      const r = await fetch(`${env.AI_SERVICE_URL}/model-info`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) info = await r.json();
    } catch {
      info = null;
    }
  }
  res.json({ up, info });
});

aiRouter.post('/analyze', aiLimiter, async (req, res, next) => {
  try {
    const { chainId } = z.object({ chainId: z.coerce.number().int().positive() }).parse(req.body);
    res.json(await runAnalysis(chainId));
  } catch (err) {
    next(err);
  }
});

aiRouter.get('/analyses/:chainId', async (req, res, next) => {
  try {
    const chainId = z.coerce.number().int().positive().parse(req.params.chainId);
    const rows = await prisma.aiAnalysis.findMany({
      where: { artifactChainId: chainId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ items: rows.map(toAnalysisDto) });
  } catch (err) {
    next(err);
  }
});

// ── /api/demo ──────────────────────────────────────────────

export const demoRouter = Router();

demoRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await demoStatus());
  } catch (err) {
    next(err);
  }
});

demoRouter.post('/load', demoLimiter, requireAuth('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await loadDemoData());
  } catch (err) {
    next(err);
  }
});

demoRouter.post('/tamper', demoLimiter, requireAuth('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await simulateIntegrityViolation());
  } catch (err) {
    next(err);
  }
});

demoRouter.post('/run-verification', demoLimiter, requireAuth('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await runVerificationDemo());
  } catch (err) {
    next(err);
  }
});

demoRouter.post('/reset', demoLimiter, requireAuth('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await resetDemo());
  } catch (err) {
    next(err);
  }
});

// ── /api/storage ───────────────────────────────────────────

export const storageRouter = Router();

storageRouter.get('/:cid', async (req, res, next) => {
  try {
    const cid = decodeURIComponent(req.params.cid);
    const bytes = await ipfsService.getObject(cid);
    if (!bytes) throw notFound('Stored object not found');
    const asJson = req.query.json === '1';
    res.setHeader('Content-Type', asJson ? 'application/json' : 'application/octet-stream');
    res.setHeader('X-Storage-Mode', ipfsService.modeLabel());
    res.send(Buffer.from(bytes));
  } catch (err) {
    next(err);
  }
});
