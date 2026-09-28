import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { FileInput } from '@proofchain/crypto';
import { ARTIFACT_TYPES } from '@proofchain/shared';
import { env } from '../config.js';
import { prisma } from '../db.js';
import { badRequest } from '../errors.js';
import { requireAuth, WRITER_ROLES } from '../middleware/auth.js';
import {
  confirmClientTx,
  getArtifactDetail,
  prepareUpload,
  provenanceGraph,
  registerServerSide,
  revokeServerSide,
  toArtifactRecord,
  transferServerSide,
  indexArtifactFromChain,
  type RegistrationPayload,
} from '../services/artifacts.js';
import { latestAnalyses } from '../services/ai.js';
import { verifyFiles, verifyStoredCopy } from '../services/verify.js';
import { verifyLimiter } from './limiters.js';

export const artifactsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: env.MAX_FILES_PER_ARTIFACT,
  },
});

/** Reassemble FileInput[] from a multipart request (paths preserved via `paths` field). */
export function filesFromRequest(req: {
  files?: Express.Multer.File[] | { [field: string]: Express.Multer.File[] };
  body: Record<string, unknown>;
}): FileInput[] {
  const list = Array.isArray(req.files) ? req.files : (req.files?.files ?? []);
  if (!list || list.length === 0) throw badRequest('No files uploaded (field name: "files")');
  let paths: string[] | null = null;
  if (typeof req.body.paths === 'string' && req.body.paths.length > 0) {
    try {
      const parsed = JSON.parse(req.body.paths);
      if (Array.isArray(parsed) && parsed.length === list.length) {
        paths = parsed.map(String);
      }
    } catch {
      throw badRequest('`paths` must be a JSON array aligned with the uploaded files');
    }
  }
  return list.map((f, i) => ({
    path: paths?.[i] ?? f.originalname,
    bytes: new Uint8Array(f.buffer),
  }));
}

const ListQuery = z.object({
  type: z.enum(ARTIFACT_TYPES).optional(),
  q: z.string().max(200).optional(),
  owner: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

artifactsRouter.get('/', async (req, res, next) => {
  try {
    const query = ListQuery.parse(req.query);
    const where = {
      ...(query.type ? { artifactType: query.type } : {}),
      ...(query.owner ? { ownerAddress: { equals: query.owner } } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q } }, { creator: { contains: query.q } }, { artifactHash: { contains: query.q.toLowerCase() } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.artifact.count({ where }),
      prisma.artifact.findMany({
        where,
        orderBy: { chainId: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const risks = await latestAnalyses(rows.map((r) => r.chainId));
    res.json({
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((r) => ({ ...toArtifactRecord(r), latestRisk: risks.get(r.chainId) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

const chainIdParam = z.coerce.number().int().positive();

artifactsRouter.get('/:chainId', async (req, res, next) => {
  try {
    res.json(await getArtifactDetail(chainIdParam.parse(req.params.chainId)));
  } catch (err) {
    next(err);
  }
});

artifactsRouter.get('/:chainId/provenance', async (req, res, next) => {
  try {
    res.json(await provenanceGraph(chainIdParam.parse(req.params.chainId)));
  } catch (err) {
    next(err);
  }
});

artifactsRouter.get('/:chainId/blockchain', async (req, res, next) => {
  try {
    const chainId = chainIdParam.parse(req.params.chainId);
    const transactions = await prisma.blockchainTransaction.findMany({
      where: { artifactChainId: chainId },
      orderBy: { blockNumber: 'asc' },
    });
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

// ── Registration (two-phase) ───────────────────────────────

const FieldsSchema = z.record(z.string(), z.string().max(2000)).default({});

const PrepareSchema = z.object({
  artifactType: z.enum(ARTIFACT_TYPES),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  version: z.string().min(1).max(60),
  creator: z.string().max(200).default(''),
  fields: z.string().optional(), // JSON-encoded TypeSpecificFields
  parentChainId: z.coerce.number().int().positive().optional(),
  asVersion: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

artifactsRouter.post(
  '/prepare',
  requireAuth(...WRITER_ROLES),
  upload.array('files'),
  async (req, res, next) => {
    try {
      const body = PrepareSchema.parse(req.body);
      const fields = body.fields ? FieldsSchema.parse(JSON.parse(body.fields)) : {};
      const files = filesFromRequest(req as never);
      const payload: RegistrationPayload = {
        artifactType: body.artifactType,
        name: body.name,
        description: body.description,
        version: body.version,
        creator: body.creator,
        fields,
        parentChainId: body.parentChainId ?? null,
        asVersion: Boolean(body.asVersion && body.parentChainId),
      };
      res.json(await prepareUpload(files, payload, req.user?.id ?? null));
    } catch (err) {
      next(err);
    }
  }
);

artifactsRouter.post('/register', requireAuth(...WRITER_ROLES), async (req, res, next) => {
  try {
    const { preparedId } = z.object({ preparedId: z.string().min(1) }).parse(req.body);
    res.json({ artifact: await registerServerSide(preparedId), signer: 'server' });
  } catch (err) {
    next(err);
  }
});

artifactsRouter.post('/confirm', requireAuth(...WRITER_ROLES), async (req, res, next) => {
  try {
    const { preparedId, txHash } = z
      .object({ preparedId: z.string().min(1), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
      .parse(req.body);
    res.json({ artifact: await confirmClientTx(preparedId, txHash), signer: 'wallet' });
  } catch (err) {
    next(err);
  }
});

// ── Verification against a specific artifact ───────────────

artifactsRouter.post('/:chainId/verify', verifyLimiter, upload.array('files'), async (req, res, next) => {
  try {
    const chainId = chainIdParam.parse(req.params.chainId);
    const files = filesFromRequest(req as never);
    res.json(await verifyFiles(files, { targetChainId: chainId }));
  } catch (err) {
    next(err);
  }
});

artifactsRouter.post('/:chainId/verify-stored', verifyLimiter, async (req, res, next) => {
  try {
    res.json(await verifyStoredCopy(chainIdParam.parse(req.params.chainId)));
  } catch (err) {
    next(err);
  }
});

// ── Ownership / revocation (server dev signer path) ────────

artifactsRouter.post('/:chainId/transfer', requireAuth(...WRITER_ROLES), async (req, res, next) => {
  try {
    const chainId = chainIdParam.parse(req.params.chainId);
    const { newOwner } = z
      .object({ newOwner: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum address') })
      .parse(req.body);
    res.json({ artifact: await transferServerSide(chainId, newOwner) });
  } catch (err) {
    next(err);
  }
});

artifactsRouter.post('/:chainId/revoke', requireAuth(...WRITER_ROLES), async (req, res, next) => {
  try {
    res.json({ artifact: await revokeServerSide(chainIdParam.parse(req.params.chainId)) });
  } catch (err) {
    next(err);
  }
});

/** Re-index from chain after a wallet-signed transfer/revoke/version. */
artifactsRouter.post('/:chainId/sync', requireAuth(), async (req, res, next) => {
  try {
    const row = await indexArtifactFromChain(chainIdParam.parse(req.params.chainId), null);
    res.json({ artifact: toArtifactRecord(row) });
  } catch (err) {
    next(err);
  }
});
