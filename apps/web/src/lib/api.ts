/**
 * Typed API client. All reads go through React Query; mutations use the
 * same `request` helper. Errors surface the API's human-readable message.
 */
import type {
  AiAnalysisResult,
  ArtifactRecord,
  DashboardStats,
  NetworkConfig,
  SessionUser,
  VerificationResult,
} from '@proofchain/types';

const TOKEN_KEY = 'proofchain.token';
const USER_KEY = 'proofchain.user';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

// ── Session store (tiny, no dependency) ────────────────────

type SessionState = { token: string | null; user: SessionUser | null };
const listeners = new Set<() => void>();

function readSession(): SessionState {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    return { token, user: rawUser ? (JSON.parse(rawUser) as SessionUser) : null };
  } catch {
    return { token: null, user: null };
  }
}

let session: SessionState = readSession();

export const sessionStore = {
  get: () => session,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(token: string | null, user: SessionUser | null) {
    session = { token, user };
    try {
      if (token && user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    } catch {
      // Session persistence is a convenience; the in-memory copy still works.
    }
    listeners.forEach((l) => l());
  },
};

// ── Core request helper ────────────────────────────────────

export async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.auth !== false && session.token) {
    headers.set('Authorization', `Bearer ${session.token}`);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'The ProofChain API is unreachable. Is the backend running on port 4000?');
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let message = `Request failed (HTTP ${res.status})`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      // non-JSON error body
    }
    if (res.status === 401) sessionStore.set(null, null);
    throw new ApiRequestError(res.status, code, message, details);
  }
  return (await res.json()) as T;
}

// ── Endpoints ──────────────────────────────────────────────

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      auth: false,
    }),

  networkConfig: () => request<NetworkConfig>('/api/network/config'),
  dashboardStats: () => request<DashboardStats>('/api/dashboard/stats'),

  artifacts: (params: { type?: string; q?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    return request<{ total: number; page: number; pageSize: number; items: ArtifactRecord[] }>(
      `/api/artifacts?${qs}`
    );
  },

  artifactDetail: (chainId: number) => request<ArtifactDetail>(`/api/artifacts/${chainId}`),
  provenance: (chainId: number) => request<ProvenanceGraph>(`/api/artifacts/${chainId}/provenance`),

  prepare: (form: FormData) =>
    request<PreparedSummary>('/api/artifacts/prepare', { method: 'POST', body: form }),
  registerServer: (preparedId: string) =>
    request<{ artifact: ArtifactRecord; signer: string }>('/api/artifacts/register', {
      method: 'POST',
      body: JSON.stringify({ preparedId }),
    }),
  confirmWalletTx: (preparedId: string, txHash: string) =>
    request<{ artifact: ArtifactRecord; signer: string }>('/api/artifacts/confirm', {
      method: 'POST',
      body: JSON.stringify({ preparedId, txHash }),
    }),
  transfer: (chainId: number, newOwner: string) =>
    request<{ artifact: ArtifactRecord }>(`/api/artifacts/${chainId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ newOwner }),
    }),
  revoke: (chainId: number) =>
    request<{ artifact: ArtifactRecord }>(`/api/artifacts/${chainId}/revoke`, { method: 'POST' }),
  sync: (chainId: number) =>
    request<{ artifact: ArtifactRecord }>(`/api/artifacts/${chainId}/sync`, { method: 'POST' }),

  verify: (form: FormData) =>
    request<VerificationResult>('/api/verify', { method: 'POST', body: form, auth: false }),
  verifyStored: (chainId: number) =>
    request<VerificationResult>(`/api/artifacts/${chainId}/verify-stored`, { method: 'POST' }),
  verifyHistory: () => request<{ items: VerificationHistoryItem[] }>('/api/verify/history'),

  blocks: (limit = 12) => request<BlocksResponse>(`/api/blockchain/blocks?limit=${limit}`),
  transactions: (page = 1) => request<TxPage>(`/api/blockchain/transactions?page=${page}`),
  chainEvents: (limit = 60) => request<{ items: ChainEventItem[] }>(`/api/blockchain/events?limit=${limit}`),

  aiStatus: () => request<{ up: boolean; info: AiModelInfo | null }>('/api/ai/status'),
  aiAnalyze: (chainId: number) =>
    request<AiAnalysisResult>('/api/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ chainId }),
    }),
  aiAnalyses: (chainId: number) =>
    request<{ items: AiAnalysisResult[] }>(`/api/ai/analyses/${chainId}`),

  demoStatus: () =>
    request<{ loaded: boolean; tampered: boolean; artifactCount: number; serverSigner: string | null }>(
      '/api/demo/status'
    ),
  demoLoad: () => request<{ log: string[]; artifactCount: number }>('/api/demo/load', { method: 'POST' }),
  demoTamper: () =>
    request<{ tampered: boolean; artifactChainId: number; file: string; note: string }>('/api/demo/tamper', {
      method: 'POST',
    }),
  demoRunVerification: () =>
    request<{ intact: VerificationResult; tamperTarget: VerificationResult }>(
      '/api/demo/run-verification',
      { method: 'POST' }
    ),
  demoReset: () =>
    request<{ reset: boolean; newContractAddress: string; note: string }>('/api/demo/reset', {
      method: 'POST',
    }),
};

// ── Response shapes not in shared types ────────────────────

export interface StoredFileRef {
  path: string;
  sha256: string;
  size: number;
  cid: string;
}

export interface ArtifactDetail {
  artifact: ArtifactRecord;
  lineage: ArtifactRecord[];
  children: ArtifactRecord[];
  files: StoredFileRef[];
  manifestCid: string | null;
  gatewayUrl: string | null;
  storageLabel: string;
  verifications: {
    id: string;
    matched: boolean;
    suppliedHash: string;
    registeredHash: string | null;
    method: string;
    fileName: string;
    createdAt: string;
  }[];
  analyses: AiAnalysisResult[];
  transactions: TxRow[];
  events: { id: string; type: string; txHash: string | null; blockNumber: number | null; data: Record<string, unknown>; createdAt: string }[];
}

export interface ProvenanceGraph {
  nodes: {
    chainId: number;
    name: string;
    artifactType: string;
    version: string;
    artifactHash: string;
    ownerAddress: string;
    registeredAt: string;
    active: boolean;
    riskLevel: string | null;
    focus: boolean;
  }[];
  edges: { from: number; to: number; kind: 'version' | 'derived' }[];
}

export interface PreparedSummary {
  preparedId: string;
  artifactHash: string;
  merkleRoot: string | null;
  metadataCid: string;
  manifestCid: string;
  fileCount: number;
  sizeBytes: number;
  storageMode: 'local' | 'pinata';
  merkleLayers: number[] | null;
  duplicate: { exists: boolean; artifactId: number };
  files: { path: string; sha256: string; size: number }[];
}

export interface BlocksResponse {
  chainUp: boolean;
  latestBlock?: number;
  blocks: {
    number: number;
    hash: string;
    parentHash: string;
    timestamp: string;
    txCount: number;
    txHashes: string[];
    gasUsed: string;
  }[];
}

export interface TxRow {
  id: string;
  txHash: string;
  blockNumber: number;
  fromAddress: string;
  toAddress: string | null;
  method: string | null;
  status: string;
  gasUsed: string | null;
  artifactChainId: number | null;
  network: string;
  blockTimestamp: string | null;
}

export interface TxPage {
  total: number;
  page: number;
  pageSize: number;
  items: TxRow[];
}

export interface ChainEventItem {
  id: string;
  type: string;
  artifactChainId: number | null;
  artifactLabel: string | null;
  txHash: string | null;
  blockNumber: number | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface VerificationHistoryItem {
  id: string;
  artifactChainId: number | null;
  artifactLabel: string | null;
  matched: boolean;
  suppliedHash: string;
  registeredHash: string | null;
  method: string;
  fileName: string;
  createdAt: string;
}

export interface AiModelInfo {
  mlModel: string;
  mlModelVersion: string;
  baselineVersion: string;
  minSamplesForMl: number;
  features: string[];
  riskThresholds: Record<string, number>;
  note: string;
}
