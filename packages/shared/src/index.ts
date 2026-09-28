/**
 * Shared constants used by the web app and the API.
 * The registry ABI is the single client-side source of truth for the
 * contract interface (human-readable ethers v6 fragments). It must stay
 * in sync with blockchain/contracts/ProofChainRegistry.sol — contract
 * tests exercise every fragment listed here.
 */

export const PROOFCHAIN_REGISTRY_ABI = [
  // ── Write ────────────────────────────────────────────────
  'function registerArtifact(string artifactType, string name, string version, bytes32 artifactHash, string metadataCID, uint256 parentArtifactId) returns (uint256)',
  'function updateArtifactVersion(uint256 parentArtifactId, string newVersion, bytes32 newHash, string newMetadataCID) returns (uint256)',
  'function transferArtifactOwnership(uint256 artifactId, address newOwner)',
  'function revokeArtifact(uint256 artifactId)',

  // ── Read ─────────────────────────────────────────────────
  'function verifyArtifact(bytes32 artifactHash) view returns (bool exists, uint256 artifactId, bool active, address owner, uint256 timestamp)',
  'function getArtifact(uint256 artifactId) view returns (tuple(uint256 id, string artifactType, string name, string version, bytes32 artifactHash, string metadataCID, address owner, uint256 timestamp, uint256 parentArtifactId, bool active))',
  'function getArtifactHistory(uint256 artifactId) view returns (tuple(uint256 id, string artifactType, string name, string version, bytes32 artifactHash, string metadataCID, address owner, uint256 timestamp, uint256 parentArtifactId, bool active)[])',
  'function getArtifactsByOwner(address owner) view returns (uint256[])',
  'function getChildren(uint256 artifactId) view returns (uint256[])',
  'function totalArtifacts() view returns (uint256)',
  'function artifactIdByHash(bytes32) view returns (uint256)',

  // ── Events ───────────────────────────────────────────────
  'event ArtifactRegistered(uint256 indexed artifactId, bytes32 indexed artifactHash, address indexed owner, string artifactType, string name, string version, string metadataCID, uint256 parentArtifactId, uint256 timestamp)',
  'event ArtifactVersionCreated(uint256 indexed parentArtifactId, uint256 indexed newArtifactId, bytes32 indexed newHash, string newVersion, uint256 timestamp)',
  'event ArtifactOwnershipTransferred(uint256 indexed artifactId, address indexed previousOwner, address indexed newOwner, uint256 timestamp)',
  'event ArtifactRevoked(uint256 indexed artifactId, address indexed owner, uint256 timestamp)',
] as const;

export const PROOF_CERTIFICATE_ABI = [
  'function mintCertificate(uint256 artifactId) returns (uint256)',
  'function certificateForArtifact(uint256 artifactId) view returns (uint256)',
  'function artifactForCertificate(uint256 tokenId) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalCertificates() view returns (uint256)',
  'event CertificateMinted(uint256 indexed tokenId, uint256 indexed artifactId, address indexed owner)',
] as const;

export const ARTIFACT_TYPES = ['DATASET', 'MODEL', 'SOFTWARE'] as const;

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const RISK_THRESHOLDS = {
  MEDIUM: 0.35,
  HIGH: 0.6,
  CRITICAL: 0.82,
} as const;

export const EVENT_NAMES = [
  'ArtifactRegistered',
  'ArtifactVersionCreated',
  'ArtifactOwnershipTransferred',
  'ArtifactRevoked',
] as const;

/** 0x71A…92F style shortening for addresses/hashes. */
export function shortHex(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return '—';
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

export function riskLevelFromScore(score: number): (typeof RISK_LEVELS)[number] {
  if (score >= RISK_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (score >= RISK_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}
