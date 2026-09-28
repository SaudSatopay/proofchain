import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, sessionStore } from '../lib/api';
import { connectWallet, disconnectWallet, ensureNetwork, useWallet } from '../lib/wallet';
import { shortHex } from '../lib/format';
import { Tag } from '../components/ui';

const NAV = [
  { to: '/app', label: 'OVERVIEW', end: true },
  { to: '/app/artifacts', label: 'ARTIFACTS' },
  { to: '/app/register', label: 'REGISTER' },
  { to: '/app/verify', label: 'VERIFY' },
  { to: '/app/provenance', label: 'PROVENANCE' },
  { to: '/app/blockchain', label: 'BLOCKCHAIN' },
  { to: '/app/analysis', label: 'AI ANALYSIS' },
  { to: '/app/settings', label: 'SETTINGS' },
];

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
}

export function AppLayout() {
  const session = useSession();
  const wallet = useWallet();
  const navigate = useNavigate();
  const { data: net } = useQuery({
    queryKey: ['network'],
    queryFn: api.networkConfig,
    refetchInterval: 10_000,
  });

  const wrongNetwork =
    wallet.address != null && net != null && wallet.chainId != null && wallet.chainId !== net.chainId;

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand">
          PROOFCHAIN
          <span className="net">{net?.network ?? '···'}</span>
        </Link>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="mono-xs faint">REGISTRY</div>
          <div className="mono-xs dim" title={net?.contractAddress ?? ''}>
            {net?.contractAddress ? shortHex(net.contractAddress, 8, 6) : 'NOT DEPLOYED'}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Tag tone={net?.chainUp ? 'ok' : 'bad'}>{net?.chainUp ? 'CHAIN' : 'CHAIN DOWN'}</Tag>
            <Tag tone={net?.aiServiceUp ? 'ok' : ''}>{net?.aiServiceUp ? 'AI' : 'AI OFF'}</Tag>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 14 }}>
            <span className="mono-xs dim">
              BLOCK <span style={{ color: 'var(--ink)' }}>#{net?.latestBlock ?? '—'}</span>
            </span>
            <span className="mono-xs faint">·</span>
            <span className="mono-xs dim">{net?.storageMode === 'pinata' ? 'IPFS' : 'LOCAL DEV STORAGE'}</span>
            {wrongNetwork && (
              <button
                className="btn sm danger"
                onClick={() => net && ensureNetwork(net.chainId, net.rpcUrl, net.network)}
              >
                WRONG NETWORK — SWITCH TO {net?.chainId}
              </button>
            )}
          </div>
          <div className="row">
            {wallet.address ? (
              <>
                <span className="mono-xs dim" title={wallet.address}>
                  {shortHex(wallet.address, 6, 4)}
                  {wallet.balance ? ` · ${Number(wallet.balance).toFixed(3)} ETH` : ''}
                </span>
                <button className="btn sm ghost" onClick={disconnectWallet}>
                  DISCONNECT
                </button>
              </>
            ) : (
              <button className="btn sm" onClick={() => void connectWallet()} disabled={wallet.connecting}>
                {wallet.connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
              </button>
            )}
            {session.user ? (
              <>
                <Tag dot={false} tone="accent">{session.user.role}</Tag>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    sessionStore.set(null, null);
                    navigate('/app');
                  }}
                >
                  SIGN OUT
                </button>
              </>
            ) : (
              <Link className="btn sm primary" to="/login">
                SIGN IN
              </Link>
            )}
          </div>
        </header>
        {wallet.error && (
          <div style={{ padding: '10px 28px 0' }}>
            <div className="notice err">{wallet.error}</div>
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
}
