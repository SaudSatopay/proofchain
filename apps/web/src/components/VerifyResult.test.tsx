import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { VerificationResult } from '@proofchain/types';
import { VerifyResultPanel } from './VerifyResult';

const baseArtifact = {
  id: 'x1',
  chainId: 3,
  artifactType: 'DATASET' as const,
  name: 'Flood Detection Dataset',
  description: '',
  version: 'v1.0',
  creator: 'Lab',
  fields: {},
  artifactHash: '0x' + 'ab'.repeat(32),
  merkleRoot: null,
  fileCount: 3,
  sizeBytes: 1000,
  metadataCid: 'local:abc',
  storageMode: 'local' as const,
  ownerAddress: '0x' + '11'.repeat(20),
  parentChainId: null,
  rootChainId: 3,
  active: true,
  network: 'localhost',
  contractAddress: '0x' + '22'.repeat(20),
  txHash: '0x' + 'cd'.repeat(32),
  blockNumber: 7,
  gasUsed: '123456',
  registeredAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

function makeResult(overrides: Partial<VerificationResult>): VerificationResult {
  return {
    matched: true,
    artifact: baseArtifact,
    suppliedHash: '0x' + 'ab'.repeat(32),
    registeredHash: '0x' + 'ab'.repeat(32),
    method: 'MERKLE',
    fileCount: 3,
    sizeBytes: 1000,
    fileName: 'dataset',
    manifestDiff: null,
    chain: {
      verified: true,
      contractAddress: baseArtifact.contractAddress,
      network: 'localhost',
      txHash: baseArtifact.txHash,
      blockNumber: 7,
      timestamp: new Date().toISOString(),
    },
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

const renderResult = (result: VerificationResult) =>
  render(
    <MemoryRouter>
      <VerifyResultPanel result={result} />
    </MemoryRouter>
  );

describe('VerifyResultPanel', () => {
  it('renders the verified verdict with chain facts', () => {
    renderResult(makeResult({}));
    expect(screen.getByText(/integrity verified/i)).toBeInTheDocument();
    expect(screen.getByText(/fingerprint matches the on-chain commitment/i)).toBeInTheDocument();
    expect(screen.getByText(/Flood Detection Dataset v1\.0/)).toBeInTheDocument();
  });

  it('renders the mismatch verdict with both hashes and the manifest diff', () => {
    renderResult(
      makeResult({
        matched: false,
        suppliedHash: '0x' + 'ff'.repeat(32),
        manifestDiff: { missing: [], added: [], modified: ['labels.csv'] },
      })
    );
    expect(screen.getByText(/integrity mismatch/i)).toBeInTheDocument();
    expect(screen.getByText('labels.csv')).toBeInTheDocument();
    expect(screen.getByText('MODIFIED')).toBeInTheDocument();
  });

  it('renders the unregistered state when no commitment exists', () => {
    renderResult(makeResult({ matched: false, artifact: null, registeredHash: null, chain: null }));
    expect(screen.getByText(/not registered/i)).toBeInTheDocument();
    expect(screen.getByText(/no on-chain commitment exists/i)).toBeInTheDocument();
  });
});
