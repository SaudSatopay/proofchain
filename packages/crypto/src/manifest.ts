/**
 * Deterministic artifact manifests.
 *
 * A manifest lists every file in an artifact with its SHA-256 digest.
 * Determinism rules (so any party can reproduce the same fingerprint):
 *   - paths are normalized to forward slashes, no leading "./"
 *   - entries are sorted by path using UTF-16 code-unit order
 *   - the artifact fingerprint is the Merkle root over the sorted leaf digests
 *   - for a single file the fingerprint is simply its SHA-256
 */

import { buildMerkleTree, type MerkleTree } from './merkle.js';
import { sha256Hex } from './sha256.js';

export interface FileInput {
  path: string;
  bytes: Uint8Array;
}

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface FingerprintResult {
  /** bytes32-ready hex (no 0x): merkle root for multi-file, sha256 for single. */
  artifactHash: string;
  merkleRoot: string | null;
  tree: MerkleTree | null;
  entries: ManifestEntry[];
  totalSize: number;
  /** Canonical JSON manifest — this exact string is what gets stored. */
  manifestJson: string;
  /** SHA-256 of the canonical manifest JSON. */
  manifestHash: string;
}

export function normalizePath(p: string): string {
  let out = p.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  if (out.startsWith('/')) out = out.slice(1);
  return out;
}

export function sortEntries<T extends { path: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Canonical JSON with a fixed field order — byte-stable across platforms. */
export function canonicalManifestJson(entries: ManifestEntry[], merkleRoot: string | null): string {
  const sorted = sortEntries(entries);
  return JSON.stringify(
    {
      algorithm: 'sha256',
      merkleRoot,
      files: sorted.map((e) => ({ path: e.path, sha256: e.sha256, size: e.size })),
    },
    null,
    2
  );
}

/**
 * Hash a set of files into the artifact fingerprint committed on-chain.
 * Single file  → SHA-256(file)
 * Multiple files → Merkle root over sorted per-file SHA-256 leaves
 */
export async function fingerprintFiles(files: FileInput[]): Promise<FingerprintResult> {
  if (files.length === 0) throw new Error('At least one file is required');

  const seen = new Set<string>();
  const entries: ManifestEntry[] = [];
  let totalSize = 0;

  for (const f of files) {
    const path = normalizePath(f.path);
    if (seen.has(path)) throw new Error(`Duplicate path in artifact: ${path}`);
    seen.add(path);
    entries.push({ path, sha256: await sha256Hex(f.bytes), size: f.bytes.byteLength });
    totalSize += f.bytes.byteLength;
  }

  const sorted = sortEntries(entries);

  let artifactHash: string;
  let merkleRoot: string | null = null;
  let tree: MerkleTree | null = null;

  if (sorted.length === 1) {
    artifactHash = sorted[0].sha256;
  } else {
    tree = await buildMerkleTree(sorted.map((e) => e.sha256));
    merkleRoot = tree.root;
    artifactHash = tree.root;
  }

  const manifestJson = canonicalManifestJson(sorted, merkleRoot);
  const manifestHash = await sha256Hex(manifestJson);

  return { artifactHash, merkleRoot, tree, entries: sorted, totalSize, manifestJson, manifestHash };
}

/** Compare a freshly computed manifest against a registered one. */
export function diffManifests(
  registered: ManifestEntry[],
  current: ManifestEntry[]
): { missing: string[]; added: string[]; modified: string[] } {
  const regMap = new Map(registered.map((e) => [e.path, e.sha256]));
  const curMap = new Map(current.map((e) => [e.path, e.sha256]));
  const missing: string[] = [];
  const added: string[] = [];
  const modified: string[] = [];

  for (const [path, hash] of regMap) {
    if (!curMap.has(path)) missing.push(path);
    else if (curMap.get(path) !== hash) modified.push(path);
  }
  for (const path of curMap.keys()) {
    if (!regMap.has(path)) added.push(path);
  }
  return { missing: missing.sort(), added: added.sort(), modified: modified.sort() };
}
