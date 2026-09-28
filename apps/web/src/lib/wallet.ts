/**
 * MetaMask integration through ethers v6.
 *
 * Read-only browsing never needs a wallet. Write operations offer two
 * signing paths: the connected browser wallet (this module) or the API's
 * clearly-labeled local dev signer. Registration through the wallet calls
 * the registry contract directly — the API only indexes the confirmed
 * transaction afterwards.
 */
import { BrowserProvider, Contract, formatEther } from 'ethers';
import { useSyncExternalStore } from 'react';
import { PROOFCHAIN_REGISTRY_ABI } from '@proofchain/shared';

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface WalletState {
  available: boolean;
  address: string | null;
  chainId: number | null;
  balance: string | null;
  connecting: boolean;
  error: string | null;
}

let state: WalletState = {
  available: typeof window !== 'undefined' && Boolean(window.ethereum),
  address: null,
  chainId: null,
  balance: null,
  connecting: false,
  error: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setState(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  emit();
}

async function refreshDetails() {
  if (!window.ethereum || !state.address) return;
  try {
    const provider = new BrowserProvider(window.ethereum);
    const [network, balance] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(state.address),
    ]);
    setState({ chainId: Number(network.chainId), balance: formatEther(balance) });
  } catch {
    // Chain details are cosmetic; connection state stands.
  }
}

export async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    setState({
      available: false,
      error: 'MetaMask is not installed. Read-only browsing still works, and registration can use the local dev signer.',
    });
    return;
  }
  setState({ connecting: true, error: null });
  try {
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
    setState({ address: accounts[0] ?? null, connecting: false });
    await refreshDetails();
  } catch (err) {
    const anyErr = err as { code?: number; message?: string };
    setState({
      connecting: false,
      error:
        anyErr?.code === 4001
          ? 'Connection request was rejected in MetaMask.'
          : `Wallet connection failed: ${anyErr?.message ?? 'unknown error'}`,
    });
  }
}

export function disconnectWallet(): void {
  setState({ address: null, chainId: null, balance: null, error: null });
}

/** Prompt MetaMask to switch to (or add) the expected network. */
export async function ensureNetwork(expectedChainId: number, rpcUrl: string, name: string): Promise<boolean> {
  if (!window.ethereum) return false;
  const hexId = '0x' + expectedChainId.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }],
    });
    await refreshDetails();
    return true;
  } catch (err) {
    const anyErr = err as { code?: number };
    if (anyErr?.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: name === 'localhost' ? 'ProofChain Local (Hardhat)' : name,
              rpcUrls: [rpcUrl],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            },
          ],
        });
        await refreshDetails();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export interface WalletTxHandlers {
  onSigning?: () => void;
  onPending?: (txHash: string) => void;
}

/** Sign registerArtifact / updateArtifactVersion with the browser wallet. */
export async function sendRegistration(
  contractAddress: string,
  args: {
    asVersion: boolean;
    parentChainId: number | null;
    artifactType: string;
    name: string;
    version: string;
    artifactHash: string;
    metadataCid: string;
  },
  handlers: WalletTxHandlers = {}
): Promise<{ txHash: string }> {
  if (!window.ethereum) throw new Error('MetaMask is unavailable');
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const registry = new Contract(contractAddress, PROOFCHAIN_REGISTRY_ABI, signer);

  handlers.onSigning?.();
  let tx;
  try {
    tx = args.asVersion && args.parentChainId
      ? await registry.updateArtifactVersion(args.parentChainId, args.version, args.artifactHash, args.metadataCid)
      : await registry.registerArtifact(args.artifactType, args.name, args.version, args.artifactHash, args.metadataCid, args.parentChainId ?? 0);
  } catch (err) {
    throw translateWalletError(err);
  }
  handlers.onPending?.(tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error('The transaction was mined but reverted on-chain.');
  return { txHash: tx.hash };
}

function translateWalletError(err: unknown): Error {
  const anyErr = err as { code?: number | string; message?: string; shortMessage?: string };
  const msg = anyErr?.shortMessage ?? anyErr?.message ?? String(err);
  if (anyErr?.code === 4001 || anyErr?.code === 'ACTION_REJECTED') {
    return new Error('Transaction was rejected in MetaMask.');
  }
  if (msg.includes('insufficient funds')) {
    return new Error('The connected account has insufficient funds for gas on this network.');
  }
  if (msg.includes('DuplicateArtifactHash')) {
    return new Error('This exact fingerprint is already registered on-chain.');
  }
  if (msg.includes('NotArtifactOwner')) {
    return new Error('The connected wallet does not own the parent artifact on-chain.');
  }
  return new Error(`Wallet transaction failed: ${msg.slice(0, 160)}`);
}

// React 18 external-store subscription
export function useWallet(): WalletState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
}

if (typeof window !== 'undefined' && window.ethereum?.on) {
  window.ethereum.on('accountsChanged', ((accounts: string[]) => {
    setState({ address: accounts[0] ?? null });
    void refreshDetails();
  }) as never);
  window.ethereum.on('chainChanged', (() => void refreshDetails()) as never);
}
