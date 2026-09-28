/**
 * IpfsService — storage abstraction for artifact files and metadata.
 *
 * Modes:
 *   local  → content-addressed object store under <repo>/storage/objects.
 *            References look like `local:<sha256>` and are honestly
 *            labeled "Local Development Storage" in the UI. Nothing about
 *            this pretends to be IPFS, but the interface is identical, so
 *            switching to real IPFS is a config change, not a refactor.
 *   pinata → pins content through Pinata's IPFS API; references are real
 *            CIDs served via the configured gateway.
 *
 * If Pinata is configured but unreachable, calls fall back to local mode
 * (with a warning) so the application keeps working offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '@proofchain/crypto';
import type { StorageMode } from '@proofchain/types';
import { env, STORAGE_DIR } from '../config.js';

export interface StoredObject {
  cid: string;
  mode: StorageMode;
  gatewayUrl: string | null;
  sizeBytes: number;
}

const LOCAL_PREFIX = 'local:';

function localPathFor(hash: string): string {
  return path.join(STORAGE_DIR, hash.slice(0, 2), hash);
}

async function putLocal(bytes: Uint8Array): Promise<StoredObject> {
  const hash = await sha256Hex(bytes);
  const file = localPathFor(hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return { cid: `${LOCAL_PREFIX}${hash}`, mode: 'local', gatewayUrl: null, sizeBytes: bytes.byteLength };
}

async function putPinata(bytes: Uint8Array, filename: string): Promise<StoredObject> {
  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart]), filename || 'artifact.bin');
  form.append('pinataMetadata', JSON.stringify({ name: filename || 'proofchain-object' }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Pinata pin failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  }
  const json = (await res.json()) as { IpfsHash: string };
  return {
    cid: json.IpfsHash,
    mode: 'pinata',
    gatewayUrl: `${env.PINATA_GATEWAY.replace(/\/$/, '')}/ipfs/${json.IpfsHash}`,
    sizeBytes: bytes.byteLength,
  };
}

export const ipfsService = {
  mode(): StorageMode {
    return env.IPFS_MODE === 'pinata' && env.PINATA_JWT ? 'pinata' : 'local';
  },

  modeLabel(): string {
    return this.mode() === 'pinata' ? 'IPFS' : 'Local Development Storage';
  },

  async putObject(bytes: Uint8Array, filename = ''): Promise<StoredObject> {
    if (this.mode() === 'pinata') {
      try {
        return await putPinata(bytes, filename);
      } catch (err) {
        console.warn(`IPFS (Pinata) unavailable — falling back to local storage: ${String(err)}`);
        return putLocal(bytes);
      }
    }
    return putLocal(bytes);
  },

  async putJson(value: unknown, filename = 'metadata.json'): Promise<StoredObject> {
    const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
    return this.putObject(bytes, filename);
  },

  async getObject(cid: string): Promise<Uint8Array | null> {
    if (cid.startsWith(LOCAL_PREFIX)) {
      const file = localPathFor(cid.slice(LOCAL_PREFIX.length));
      return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
    }
    try {
      const res = await fetch(`${env.PINATA_GATEWAY.replace(/\/$/, '')}/ipfs/${cid}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  },

  async getJson<T>(cid: string): Promise<T | null> {
    const bytes = await this.getObject(cid);
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      return null;
    }
  },

  gatewayUrl(cid: string): string | null {
    if (cid.startsWith(LOCAL_PREFIX)) return `/api/storage/${encodeURIComponent(cid)}`;
    return `${env.PINATA_GATEWAY.replace(/\/$/, '')}/ipfs/${cid}`;
  },

  /** Local path of a stored object — used by demo tampering only. */
  localObjectPath(cid: string): string | null {
    if (!cid.startsWith(LOCAL_PREFIX)) return null;
    return localPathFor(cid.slice(LOCAL_PREFIX.length));
  },
};
