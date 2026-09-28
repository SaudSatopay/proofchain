import { describe, expect, it } from 'vitest';
import {
  buildMerkleTree,
  diffManifests,
  fingerprintFiles,
  getMerkleProof,
  sha256Hex,
  toBytes32,
  verifyMerkleProof,
} from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('sha256', () => {
  it('matches the FIPS 180-2 test vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('matches the empty-string vector', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('hashes bytes and strings identically', async () => {
    expect(await sha256Hex(enc('proofchain'))).toBe(await sha256Hex('proofchain'));
  });

  it('normalizes digests to bytes32', async () => {
    const digest = await sha256Hex('abc');
    expect(toBytes32(digest)).toBe(`0x${digest}`);
    expect(() => toBytes32('1234')).toThrow();
  });
});

describe('merkle tree', () => {
  it('root of a single leaf is the leaf itself', async () => {
    const leaf = await sha256Hex('only-file');
    const tree = await buildMerkleTree([leaf]);
    expect(tree.root).toBe(leaf);
    expect(tree.layers).toHaveLength(1);
  });

  it('is deterministic for the same leaves', async () => {
    const leaves = await Promise.all(['a', 'b', 'c', 'd'].map(sha256Hex));
    const t1 = await buildMerkleTree(leaves);
    const t2 = await buildMerkleTree(leaves);
    expect(t1.root).toBe(t2.root);
  });

  it('changes the root when any leaf changes (tamper detection)', async () => {
    const leaves = await Promise.all(['a', 'b', 'c', 'd'].map(sha256Hex));
    const original = await buildMerkleTree(leaves);
    const tampered = [...leaves];
    tampered[2] = await sha256Hex('c-MODIFIED');
    const modified = await buildMerkleTree(tampered);
    expect(modified.root).not.toBe(original.root);
  });

  it('changes the root when leaf order changes', async () => {
    const leaves = await Promise.all(['a', 'b', 'c'].map(sha256Hex));
    const t1 = await buildMerkleTree(leaves);
    const t2 = await buildMerkleTree([leaves[1], leaves[0], leaves[2]]);
    expect(t1.root).not.toBe(t2.root);
  });

  it('duplicates the last node for odd layers (3 leaves -> depth 3)', async () => {
    const leaves = await Promise.all(['a', 'b', 'c'].map(sha256Hex));
    const tree = await buildMerkleTree(leaves);
    expect(tree.layers).toHaveLength(3);
    expect(tree.layers[1]).toHaveLength(2);
  });

  it('produces verifiable inclusion proofs for every leaf', async () => {
    const leaves = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(sha256Hex));
    const tree = await buildMerkleTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = getMerkleProof(tree, i);
      expect(await verifyMerkleProof(leaves[i], proof, tree.root)).toBe(true);
    }
  });

  it('rejects proofs against the wrong leaf', async () => {
    const leaves = await Promise.all(['a', 'b', 'c', 'd'].map(sha256Hex));
    const tree = await buildMerkleTree(leaves);
    const proof = getMerkleProof(tree, 0);
    expect(await verifyMerkleProof(leaves[1], proof, tree.root)).toBe(false);
  });
});

describe('fingerprintFiles', () => {
  it('uses plain SHA-256 for a single file', async () => {
    const result = await fingerprintFiles([{ path: 'model.onnx', bytes: enc('weights') }]);
    expect(result.artifactHash).toBe(await sha256Hex('weights'));
    expect(result.merkleRoot).toBeNull();
  });

  it('is independent of input file order (sorted manifest)', async () => {
    const a = { path: 'images/a.jpg', bytes: enc('aaa') };
    const b = { path: 'images/b.jpg', bytes: enc('bbb') };
    const c = { path: 'labels.csv', bytes: enc('id,label') };
    const r1 = await fingerprintFiles([a, b, c]);
    const r2 = await fingerprintFiles([c, b, a]);
    expect(r1.artifactHash).toBe(r2.artifactHash);
    expect(r1.manifestJson).toBe(r2.manifestJson);
  });

  it('normalizes Windows-style path separators', async () => {
    const r1 = await fingerprintFiles([
      { path: 'images\\a.jpg', bytes: enc('x') },
      { path: 'images/b.jpg', bytes: enc('y') },
    ]);
    expect(r1.entries[0].path).toBe('images/a.jpg');
  });

  it('detects a modified file through the fingerprint and diff', async () => {
    const original = [
      { path: 'images/a.jpg', bytes: enc('aaa') },
      { path: 'labels.csv', bytes: enc('id,label\n1,flood') },
    ];
    const tampered = [
      { path: 'images/a.jpg', bytes: enc('aaa') },
      { path: 'labels.csv', bytes: enc('id,label\n1,dry') },
    ];
    const r1 = await fingerprintFiles(original);
    const r2 = await fingerprintFiles(tampered);
    expect(r1.artifactHash).not.toBe(r2.artifactHash);

    const diff = diffManifests(r1.entries, r2.entries);
    expect(diff.modified).toEqual(['labels.csv']);
    expect(diff.missing).toEqual([]);
    expect(diff.added).toEqual([]);
  });

  it('rejects duplicate paths', async () => {
    await expect(
      fingerprintFiles([
        { path: 'a.txt', bytes: enc('1') },
        { path: './a.txt', bytes: enc('2') },
      ])
    ).rejects.toThrow(/Duplicate path/);
  });
});
