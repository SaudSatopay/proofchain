/**
 * Shared types used across the ProofChain web app, API and tooling.
 * The blockchain remains the source of truth for provenance fields;
 * these types describe how that data is surfaced through the API.
 */

export type ArtifactType = 'DATASET' | 'MODEL' | 'SOFTWARE';

export type UserRole = 'ADMIN' | 'RESEARCHER' | 'DEVELOPER' | 'AUDITOR' | 'VIEWER';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type StorageMode = 'local' | 'pinata';

export type ProvenanceEventType =
  | 'ARTIFACT_REGISTERED'
  | 'VERSION_CREATED'
  | 'OWNERSHIP_TRANSFERRED'
  | 'ARTIFACT_REVOKED'
  | 'VERIFICATION_PASSED'
  | 'INTEGRITY_MISMATCH';

/** Type-specific metadata captured at registration time. */
export interface DatasetFields {
  organization?: string;
  license?: string;
  datasetFormat?: string;
}

export interface ModelFields {
  framework?: string;
  modelType?: string;
  datasetUsed?: string;
  trainingConfig?: string;
  license?: string;
}

export interface SoftwareFields {
  developer?: string;
  repositoryUrl?: string;
  commitHash?: string;
  packageManager?: string;
  license?: string;
}

export type TypeSpecificFields = DatasetFields & ModelFields & SoftwareFields;

/** One file inside a registered artifact, as recorded in the manifest. */
export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

/** Canonical artifact manifest — hashed deterministically. */
export interface ArtifactManifest {
  algorithm: 'sha256';
  files: ManifestEntry[];
  merkleRoot: string | null;
}

/** Artifact as indexed by the API (mirrors + enriches on-chain record). */
export interface ArtifactRecord {
  id: string;
  chainId: number;              // on-chain artifact id (uint256)
  artifactType: ArtifactType;
  name: string;
  description: string;
  version: string;
  creator: string;
  fields: TypeSpecificFields;
  artifactHash: string;         // bytes32 hex — SHA-256 or Merkle root
  merkleRoot: string | null;
  fileCount: number;
  sizeBytes: number;
  metadataCid: string;
  storageMode: StorageMode;
  ownerAddress: string;
  parentChainId: number | null;
  rootChainId: number;
  active: boolean;
  network: string;
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string | null;
  registeredAt: string;         // ISO timestamp (from block)
  createdAt: string;
  latestRisk?: AiAnalysisResult | null;
}

export interface ProvenanceEventRecord {
  id: string;
  type: ProvenanceEventType;
  artifactChainId: number | null;
  artifactName?: string | null;
  txHash: string | null;
  blockNumber: number | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface VerificationResult {
  matched: boolean;
  artifact: ArtifactRecord | null;
  suppliedHash: string;
  registeredHash: string | null;
  method: 'SHA256' | 'MERKLE';
  fileCount: number;
  sizeBytes: number;
  fileName: string;
  manifestDiff?: {
    missing: string[];
    added: string[];
    modified: string[];
  } | null;
  chain: {
    verified: boolean;
    contractAddress: string;
    network: string;
    txHash: string | null;
    blockNumber: number | null;
    timestamp: string | null;
  } | null;
  analysis?: AiAnalysisResult | null;
  checkedAt: string;
}

export interface AiAnomaly {
  code: string;
  severity: RiskLevel;
  feature: string;
  detail: string;
}

export interface AiAnalysisResult {
  riskScore: number;            // 0..1
  riskLevel: RiskLevel;
  anomalies: AiAnomaly[];
  explanation: string[];
  modelVersion: string;
  mode: 'ML' | 'BASELINE';
  sampleCount: number;
  featureCount: number;
  analyzedAt: string;
}

export interface DashboardStats {
  totalArtifacts: number;
  verifiedArtifacts: number;
  integrityViolations: number;
  blockchainTransactions: number;
  highRiskArtifacts: number;
  byType: Record<ArtifactType, number>;
  riskDistribution: Record<RiskLevel, number>;
  verificationActivity: { date: string; passed: number; failed: number }[];
  blockActivity: { blockNumber: number; txCount: number; timestamp: string }[];
  versionActivity: { date: string; registered: number; versions: number }[];
  recentEvents: ProvenanceEventRecord[];
}

export interface NetworkConfig {
  network: string;
  chainId: number;
  rpcUrl: string;
  contractAddress: string | null;
  certificateAddress: string | null;
  latestBlock: number | null;
  storageMode: StorageMode;
  aiServiceUp: boolean;
  chainUp: boolean;
  serverSignerAddress: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface TxReceiptInfo {
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  contractAddress: string;
  network: string;
}
