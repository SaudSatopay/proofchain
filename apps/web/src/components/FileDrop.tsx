/**
 * File/directory intake with REAL client-side hashing: dropped bytes are
 * fingerprinted in the browser (SHA-256 / Merkle root via WebCrypto)
 * before anything is uploaded, so the user sees the exact digest their
 * wallet will commit on-chain.
 */
import { useCallback, useRef, useState } from 'react';
import { fingerprintFiles, type FingerprintResult } from '@proofchain/crypto';
import { formatBytes } from '../lib/format';
import { Hash, Spinner } from './ui';

export interface PickedFile {
  path: string;
  file: File;
}

export interface FileDropResult {
  files: PickedFile[];
  fingerprint: FingerprintResult;
}

async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<PickedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject)
    );
    return [{ path: prefix + entry.name, file }];
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const out: PickedFile[] = [];
    // readEntries returns batches; loop until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject)
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        out.push(...(await walkEntry(child, `${prefix}${entry.name}/`)));
      }
    }
    return out;
  }
  return [];
}

export function FileDrop({
  onReady,
  onClear,
  compact = false,
}: {
  onReady: (result: FileDropResult) => void;
  onClear?: () => void;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FileDropResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    async (picked: PickedFile[]) => {
      setError(null);
      if (picked.length === 0) {
        setError('No files were found in the selection.');
        return;
      }
      setHashing(true);
      try {
        const withBytes = await Promise.all(
          picked.map(async (p) => ({
            path: p.path,
            bytes: new Uint8Array(await p.file.arrayBuffer()),
          }))
        );
        const fingerprint = await fingerprintFiles(withBytes);
        const value = { files: picked, fingerprint };
        setResult(value);
        onReady(value);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read the selected files.');
      } finally {
        setHashing(false);
      }
    },
    [onReady]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const items = [...e.dataTransfer.items];
      const picked: PickedFile[] = [];
      const entries = items
        .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
        .filter((x): x is FileSystemEntry => Boolean(x));
      if (entries.length > 0) {
        for (const entry of entries) picked.push(...(await walkEntry(entry, '')));
      } else {
        for (const file of [...e.dataTransfer.files]) picked.push({ path: file.name, file });
      }
      void ingest(picked);
    },
    [ingest]
  );

  const fromInput = (list: FileList | null, useRelative: boolean) => {
    if (!list) return;
    const picked = [...list].map((file) => ({
      path: useRelative
        ? ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
        : file.name,
      file,
    }));
    void ingest(picked);
  };

  const clear = () => {
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
    if (dirInput.current) dirInput.current.value = '';
    onClear?.();
  };

  return (
    <div className="stack">
      <div
        className={`drop-zone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
      >
        <div className="dz-title">{hashing ? 'HASHING…' : 'DROP FILES OR A DATASET DIRECTORY'}</div>
        {!compact && (
          <p style={{ fontSize: 12.5, maxWidth: 380 }}>
            Bytes are fingerprinted locally with SHA-256 before upload. Directories get a
            deterministic Merkle root over their sorted file manifest.
          </p>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="btn sm"
            onClick={(e) => {
              e.stopPropagation();
              fileInput.current?.click();
            }}
          >
            SELECT FILES
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={(e) => {
              e.stopPropagation();
              dirInput.current?.click();
            }}
          >
            SELECT DIRECTORY
          </button>
          {result && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
            >
              CLEAR
            </button>
          )}
        </div>
        {hashing && <Spinner label="COMPUTING FINGERPRINT" />}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => fromInput(e.target.files, false)}
      />
      <input
        ref={dirInput}
        type="file"
        hidden
        // Non-standard but universally supported directory picker.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => fromInput(e.target.files, true)}
      />

      {error && <div className="notice err">{error}</div>}

      {result && (
        <div className="panel">
          <div className="panel-head">
            <span className="chart-title">LOCAL FINGERPRINT</span>
            <span className="mono-xs dim">
              {result.fingerprint.entries.length} file{result.fingerprint.entries.length === 1 ? '' : 's'} ·{' '}
              {formatBytes(result.fingerprint.totalSize)}
            </span>
          </div>
          <div className="panel-body stack-sm">
            <div className="kv" style={{ fontSize: 13 }}>
              <div>{result.fingerprint.merkleRoot ? 'MERKLE ROOT' : 'SHA-256'}</div>
              <div>
                <Hash value={`0x${result.fingerprint.artifactHash}`} head={18} tail={12} />
              </div>
              {result.fingerprint.merkleRoot && (
                <>
                  <div>TREE</div>
                  <div className="mono-xs dim">
                    {result.fingerprint.tree?.layers
                      .map((l) => l.length)
                      .join(' → ')}{' '}
                    (leaves → root)
                  </div>
                </>
              )}
            </div>
            {result.fingerprint.entries.length > 1 && (
              <details>
                <summary className="mono-xs dim" style={{ cursor: 'pointer' }}>
                  FILE MANIFEST ({result.fingerprint.entries.length})
                </summary>
                <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 8 }}>
                  <table className="ledger">
                    <tbody>
                      {result.fingerprint.entries.map((entry) => (
                        <tr key={entry.path}>
                          <td className="mono-xs">{entry.path}</td>
                          <td className="mono-xs dim">{entry.sha256.slice(0, 16)}…</td>
                          <td className="mono-xs faint" style={{ textAlign: 'right' }}>
                            {formatBytes(entry.size)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
