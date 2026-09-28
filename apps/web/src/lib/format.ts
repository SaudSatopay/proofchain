export { formatBytes, shortHex } from '@proofchain/shared';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const RISK_COLOR: Record<string, string> = {
  LOW: 'var(--ok)',
  MEDIUM: 'var(--warn)',
  HIGH: 'var(--chart-serious)',
  CRITICAL: 'var(--bad)',
};

export const EVENT_LABEL: Record<string, string> = {
  ARTIFACT_REGISTERED: 'ARTIFACT_REGISTERED',
  VERSION_CREATED: 'VERSION_CREATED',
  OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED',
  ARTIFACT_REVOKED: 'ARTIFACT_REVOKED',
  VERIFICATION_PASSED: 'VERIFICATION_PASSED',
  INTEGRITY_MISMATCH: 'INTEGRITY_MISMATCH',
};

export const EVENT_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'accent' | ''> = {
  ARTIFACT_REGISTERED: 'accent',
  VERSION_CREATED: '',
  OWNERSHIP_TRANSFERRED: 'warn',
  ARTIFACT_REVOKED: 'warn',
  VERIFICATION_PASSED: 'ok',
  INTEGRITY_MISMATCH: 'bad',
};
