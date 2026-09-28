/**
 * Central configuration. Loads the single root .env, validates with zod,
 * and derives filesystem paths. No secrets are ever baked into source.
 */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const API_DIR = path.resolve(srcDir, '..');
export const REPO_ROOT = path.resolve(API_DIR, '..', '..');

loadEnv({ path: path.join(REPO_ROOT, '.env') });
process.env.DATABASE_URL ||= 'file:./data/proofchain.db';

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  RPC_URL: z.string().url().default('http://127.0.0.1:8545'),
  CHAIN_ID: z.coerce.number().int().default(31337),
  NETWORK_NAME: z.string().default('localhost'),
  PRIVATE_KEY: z.string().optional(),
  CONTRACT_ADDRESS: z.string().optional(),
  CERTIFICATE_ADDRESS: z.string().optional(),
  IPFS_MODE: z.enum(['local', 'pinata']).default('local'),
  PINATA_JWT: z.string().optional(),
  PINATA_GATEWAY: z.string().default('https://gateway.pinata.cloud'),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
  JWT_SECRET: z.string().default('dev-only-change-me'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(200),
  MAX_FILES_PER_ARTIFACT: z.coerce.number().int().positive().default(2000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Hardhat's publicly documented dev mnemonic account #0. Used only as the
// local dev signer fallback; harmless because it exists on every fresh
// Hardhat chain and controls nothing outside local development.
export const HARDHAT_DEV_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export const STORAGE_DIR = path.join(REPO_ROOT, 'storage', 'objects');
export const DEPLOYMENTS_DIR = path.join(REPO_ROOT, 'blockchain', 'deployments');
export const HARDHAT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'blockchain', 'artifacts', 'contracts');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

export const isLocalChain = env.CHAIN_ID === 31337;

export interface DeploymentInfo {
  network: string;
  chainId: number;
  contractAddress: string;
  certificateAddress: string | null;
  deployBlock: number;
  deployTxHash: string | null;
  deployedAt: string | null;
}

/** Deployment record written by `npm run deploy`; env vars override. */
export function loadDeployment(): DeploymentInfo | null {
  if (env.CONTRACT_ADDRESS) {
    return {
      network: env.NETWORK_NAME,
      chainId: env.CHAIN_ID,
      contractAddress: env.CONTRACT_ADDRESS,
      certificateAddress: env.CERTIFICATE_ADDRESS ?? null,
      deployBlock: 0,
      deployTxHash: null,
      deployedAt: null,
    };
  }
  const file = path.join(DEPLOYMENTS_DIR, `${env.NETWORK_NAME}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      network: raw.network ?? env.NETWORK_NAME,
      chainId: raw.chainId ?? env.CHAIN_ID,
      contractAddress: raw.contractAddress,
      certificateAddress: raw.certificateAddress ?? null,
      deployBlock: raw.deployBlock ?? 0,
      deployTxHash: raw.deployTxHash ?? null,
      deployedAt: raw.deployedAt ?? null,
    };
  } catch {
    return null;
  }
}

export function saveDeployment(info: DeploymentInfo): void {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DEPLOYMENTS_DIR, `${info.network}.json`),
    JSON.stringify({ ...info, deployedAt: info.deployedAt ?? new Date().toISOString() }, null, 2)
  );
}
