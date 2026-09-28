/**
 * Blockchain access layer. Everything the API knows about provenance is
 * read from (or written through) the ProofChainRegistry contract — the
 * database only indexes what this service observes on-chain.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  type TransactionReceipt,
} from 'ethers';
import { PROOFCHAIN_REGISTRY_ABI } from '@proofchain/shared';
import {
  env,
  HARDHAT_ARTIFACTS_DIR,
  HARDHAT_DEV_KEY,
  isLocalChain,
  loadDeployment,
  saveDeployment,
  type DeploymentInfo,
} from '../config.js';
import { AppError } from '../errors.js';

export interface OnChainArtifact {
  id: number;
  artifactType: string;
  name: string;
  version: string;
  artifactHash: string;
  metadataCID: string;
  owner: string;
  timestamp: number;
  parentArtifactId: number;
  active: boolean;
}

const state: {
  provider: JsonRpcProvider;
  deployment: DeploymentInfo | null;
  serverWallet: Wallet | null;
  /** NonceManager-wrapped signer: locally tracked nonces make rapid
   *  sequential transactions (demo seeding) race-free. */
  serverSigner: NonceManager | null;
} = {
  provider: new JsonRpcProvider(env.RPC_URL, undefined, { polling: true }),
  deployment: loadDeployment(),
  serverWallet: null,
  serverSigner: null,
};

const signerKey = env.PRIVATE_KEY || (isLocalChain ? HARDHAT_DEV_KEY : undefined);
if (signerKey) {
  try {
    state.serverWallet = new Wallet(signerKey, state.provider);
    state.serverSigner = new NonceManager(state.serverWallet);
  } catch {
    console.warn('PRIVATE_KEY is not a valid key — server-side signing disabled.');
  }
}

export const provider = state.provider;

export function getDeployment(): DeploymentInfo | null {
  return state.deployment;
}

export function refreshDeployment(): DeploymentInfo | null {
  state.deployment = loadDeployment();
  return state.deployment;
}

export function serverSignerAddress(): string | null {
  return state.serverWallet?.address ?? null;
}

/** Re-sync the locally tracked nonce after an external tx from the same key. */
export function resetServerNonce(): void {
  state.serverSigner?.reset();
}

export async function isChainUp(): Promise<boolean> {
  try {
    await state.provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

function requireDeployment(): DeploymentInfo {
  const dep = state.deployment ?? refreshDeployment();
  if (!dep) {
    throw new AppError(
      503,
      'CONTRACT_NOT_DEPLOYED',
      'No ProofChainRegistry deployment found. Run `npm run deploy` against the local Hardhat node first.'
    );
  }
  return dep;
}

/** Read-only registry bound to the provider. */
export function registry(): Contract {
  const dep = requireDeployment();
  return new Contract(dep.contractAddress, PROOFCHAIN_REGISTRY_ABI, state.provider);
}

/** Registry bound to the server-side dev signer (demo mode / no-wallet fallback). */
export function registryAsServer(): Contract {
  if (!state.serverSigner) {
    throw new AppError(
      503,
      'NO_SERVER_SIGNER',
      'Server-side signing is not configured (set PRIVATE_KEY) — use a browser wallet instead.'
    );
  }
  const dep = requireDeployment();
  return new Contract(dep.contractAddress, PROOFCHAIN_REGISTRY_ABI, state.serverSigner);
}

export function toOnChainArtifact(raw: Record<string, unknown> | ArrayLike<unknown>): OnChainArtifact {
  const a = raw as {
    id: bigint;
    artifactType: string;
    name: string;
    version: string;
    artifactHash: string;
    metadataCID: string;
    owner: string;
    timestamp: bigint;
    parentArtifactId: bigint;
    active: boolean;
  };
  return {
    id: Number(a.id),
    artifactType: a.artifactType,
    name: a.name,
    version: a.version,
    artifactHash: a.artifactHash.toLowerCase(),
    metadataCID: a.metadataCID,
    owner: a.owner,
    timestamp: Number(a.timestamp),
    parentArtifactId: Number(a.parentArtifactId),
    active: a.active,
  };
}

export async function getArtifactFromChain(chainArtifactId: number): Promise<OnChainArtifact> {
  const result = await registry().getArtifact(chainArtifactId);
  return toOnChainArtifact(result);
}

export async function verifyHashOnChain(artifactHash: string): Promise<{
  exists: boolean;
  artifactId: number;
  active: boolean;
  owner: string;
  timestamp: number;
}> {
  const [exists, artifactId, active, owner, timestamp] = await registry().verifyArtifact(artifactHash);
  return {
    exists: Boolean(exists),
    artifactId: Number(artifactId),
    active: Boolean(active),
    owner: String(owner),
    timestamp: Number(timestamp),
  };
}

export interface DecodedRegistration {
  artifactId: number;
  artifactHash: string;
  owner: string;
  parentArtifactId: number;
}

/** Extract the ArtifactRegistered event from a receipt (any signer). */
export function decodeRegistration(receipt: TransactionReceipt): DecodedRegistration | null {
  const contract = registry();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.target.toString().toLowerCase()) continue;
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'ArtifactRegistered') {
        return {
          artifactId: Number(parsed.args.artifactId),
          artifactHash: String(parsed.args.artifactHash).toLowerCase(),
          owner: String(parsed.args.owner),
          parentArtifactId: Number(parsed.args.parentArtifactId),
        };
      }
    } catch {
      // Non-registry log — ignore.
    }
  }
  return null;
}

/**
 * Redeploy a fresh registry (demo reset). Reads the compiled Hardhat
 * artifact so the bytecode is exactly what the tests verified. Only
 * permitted on the local development chain.
 */
export async function redeployRegistry(): Promise<DeploymentInfo> {
  if (!isLocalChain) {
    throw new AppError(400, 'LOCAL_ONLY', 'Demo reset redeploys the registry and is limited to the local Hardhat chain.');
  }
  if (!state.serverSigner) {
    throw new AppError(503, 'NO_SERVER_SIGNER', 'Server signer unavailable — cannot redeploy.');
  }
  const artifactPath = path.join(
    HARDHAT_ARTIFACTS_DIR,
    'ProofChainRegistry.sol',
    'ProofChainRegistry.json'
  );
  if (!fs.existsSync(artifactPath)) {
    throw new AppError(
      503,
      'CONTRACT_ARTIFACT_MISSING',
      'Compiled contract not found. Run `npm run deploy` once so Hardhat compiles the contracts.'
    );
  }
  const compiled = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, state.serverSigner);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction()!.wait();

  // Redeploy the certificate contract alongside so the pair stays linked.
  let certificateAddress: string | null = null;
  const certPath = path.join(HARDHAT_ARTIFACTS_DIR, 'ProofCertificate.sol', 'ProofCertificate.json');
  if (fs.existsSync(certPath)) {
    const certCompiled = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    const certFactory = new ContractFactory(certCompiled.abi, certCompiled.bytecode, state.serverSigner);
    const cert = await certFactory.deploy(await contract.getAddress());
    await cert.deploymentTransaction()!.wait();
    certificateAddress = await cert.getAddress();
  }

  const info: DeploymentInfo = {
    network: env.NETWORK_NAME,
    chainId: env.CHAIN_ID,
    contractAddress: await contract.getAddress(),
    certificateAddress,
    deployBlock: receipt!.blockNumber,
    deployTxHash: receipt!.hash,
    deployedAt: new Date().toISOString(),
  };
  saveDeployment(info);
  state.deployment = info;
  return info;
}
