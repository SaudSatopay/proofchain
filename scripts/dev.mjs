/**
 * `npm run dev` — starts the whole ProofChain stack in one terminal:
 *
 *   1. Hardhat node (local Ethereum, chainId 31337)
 *   2. Contract deployment (if this chain has no registry yet)
 *   3. Database setup (if the SQLite file is missing)
 *   4. API (Express, port 4000)
 *   5. AI service (FastAPI, port 8000 — optional, skipped if Python missing)
 *   6. Web app (Vite, port 5173)
 *
 * Each service still runs standalone (npm run chain / deploy / api / ai / web)
 * for the classic multi-terminal workflow.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const COLORS = { chain: '\x1b[33m', api: '\x1b[36m', ai: '\x1b[35m', web: '\x1b[32m' };
const RESET = '\x1b[0m';
const children = [];

function prefixed(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, shell: true, env: process.env });
  const tag = `${COLORS[name] ?? ''}[${name}]${RESET} `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        out.write(tag + buffer.slice(0, idx + 1));
        buffer = buffer.slice(idx + 1);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  children.push(child);
  return child;
}

async function rpcUp() {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(check, label, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`Timed out waiting for ${label}`);
  return false;
}

async function contractDeployed() {
  const file = path.join(root, 'blockchain', 'deployments', 'localhost.json');
  if (!fs.existsSync(file)) return false;
  try {
    const { contractAddress } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [contractAddress, 'latest'] }),
    });
    const json = await res.json();
    return typeof json.result === 'string' && json.result.length > 2;
  } catch {
    return false;
  }
}

// 1) Chain
if (await rpcUp()) {
  console.log('[chain] Hardhat node already running — reusing it.');
} else {
  prefixed('chain', 'npx', ['hardhat', 'node'], path.join(root, 'blockchain'));
  if (!(await waitFor(rpcUp, 'Hardhat node'))) process.exit(1);
}

// 2) Contracts
if (await contractDeployed()) {
  console.log('[chain] Registry contract already deployed on this chain.');
} else {
  console.log('[chain] Deploying contracts…');
  const deploy = spawnSync('npx', ['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], {
    cwd: path.join(root, 'blockchain'),
    stdio: 'inherit',
    shell: true,
  });
  if (deploy.status !== 0) process.exit(deploy.status ?? 1);
}

// 3) Database
const dbFile = path.join(root, 'apps', 'api', 'prisma', 'data', 'proofchain.db');
if (!fs.existsSync(dbFile)) {
  console.log('[api] Setting up the database (SQLite)…');
  const db = spawnSync('node', ['scripts/db-setup.mjs'], {
    cwd: path.join(root, 'apps', 'api'),
    stdio: 'inherit',
    shell: true,
  });
  if (db.status !== 0) process.exit(db.status ?? 1);
}

// 4) API, 5) AI (optional), 6) Web
prefixed('api', 'npm', ['run', 'dev', '--workspace', '@proofchain/api'], root);
prefixed('ai', 'node', ['scripts/start-ai.mjs'], root);
prefixed('web', 'npm', ['run', 'dev', '--workspace', '@proofchain/web'], root);

console.log('\nProofChain stack starting:');
console.log('  chain  http://127.0.0.1:8545  (Hardhat, chainId 31337)');
console.log('  api    http://127.0.0.1:4000/api/health');
console.log('  ai     http://127.0.0.1:8000/health   (optional)');
console.log('  web    http://127.0.0.1:5173\n');

const shutdown = () => {
  for (const child of children) {
    try {
      child.kill('SIGINT');
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
