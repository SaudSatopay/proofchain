export {
  sha256,
  sha256Hex,
  bytesToHex,
  hexToBytes,
  concatBytes,
  toBytes32,
} from './sha256.js';

export {
  buildMerkleTree,
  getMerkleProof,
  verifyMerkleProof,
  type MerkleTree,
  type MerkleProofStep,
} from './merkle.js';

export {
  fingerprintFiles,
  canonicalManifestJson,
  diffManifests,
  normalizePath,
  sortEntries,
  type FileInput,
  type ManifestEntry,
  type FingerprintResult,
} from './manifest.js';
