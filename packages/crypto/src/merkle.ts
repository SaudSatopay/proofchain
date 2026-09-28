/**
 * Merkle tree over SHA-256 digests.
 *
 * Construction (documented so every verifier can reproduce it):
 *   1. Leaves are the 32-byte SHA-256 digests of each file, ordered by the
 *      deterministic manifest ordering (see manifest.ts).
 *   2. A parent node is SHA-256(left_digest || right_digest) over the raw
 *      64 bytes — not over hex strings.
 *   3. If a layer has an odd number of nodes, the last node is duplicated
 *      (paired with itself), as in Bitcoin's block Merkle tree.
 *   4. The root of a single-leaf tree is that leaf itself, so a single-file
 *      artifact's Merkle root equals its SHA-256 — one uniform fingerprint.
 *
 * Tampering with any file changes its leaf, which changes every hash on the
 * path to the root, which breaks the on-chain bytes32 commitment.
 */

import { bytesToHex, concatBytes, hexToBytes, sha256 } from './sha256.js';

export interface MerkleTree {
  /** Hex root digest (no 0x prefix). */
  root: string;
  /** layers[0] = leaves … layers[n-1] = [root]; all hex digests. */
  layers: string[][];
  leafCount: number;
}

export interface MerkleProofStep {
  hash: string;
  /** Where the sibling sits relative to the running hash. */
  position: 'left' | 'right';
}

async function hashPair(leftHex: string, rightHex: string): Promise<string> {
  const digest = await sha256(concatBytes(hexToBytes(leftHex), hexToBytes(rightHex)));
  return bytesToHex(digest);
}

export async function buildMerkleTree(leafHashes: string[]): Promise<MerkleTree> {
  if (leafHashes.length === 0) {
    throw new Error('Cannot build a Merkle tree with zero leaves');
  }
  const normalized = leafHashes.map((h) => {
    const clean = (h.startsWith('0x') ? h.slice(2) : h).toLowerCase();
    if (clean.length !== 64) throw new Error(`Merkle leaf must be a 32-byte digest, got: ${h}`);
    return clean;
  });

  const layers: string[][] = [normalized];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i]; // duplicate odd node
      next.push(await hashPair(left, right));
    }
    layers.push(next);
  }

  return { root: layers[layers.length - 1][0], layers, leafCount: normalized.length };
}

/** Inclusion proof for the leaf at `index`. */
export function getMerkleProof(tree: MerkleTree, index: number): MerkleProofStep[] {
  if (index < 0 || index >= tree.leafCount) {
    throw new Error(`Leaf index ${index} out of range (0..${tree.leafCount - 1})`);
  }
  const proof: MerkleProofStep[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx]; // odd → self
    proof.push({ hash: sibling, position: isRightNode ? 'left' : 'right' });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute the root from a leaf and its proof; true iff it matches `root`. */
export async function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  root: string
): Promise<boolean> {
  let running = (leafHash.startsWith('0x') ? leafHash.slice(2) : leafHash).toLowerCase();
  for (const step of proof) {
    running =
      step.position === 'left'
        ? await hashPair(step.hash, running)
        : await hashPair(running, step.hash);
  }
  const cleanRoot = (root.startsWith('0x') ? root.slice(2) : root).toLowerCase();
  return running === cleanRoot;
}
