/**
 * Boots the Python AI service. Creates apps/ai-service/.venv on first run,
 * installs requirements, then launches uvicorn on port 8000.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const aiDir = path.join(root, 'apps', 'ai-service');
const venvDir = path.join(aiDir, '.venv');
const isWin = process.platform === 'win32';
const venvPython = path.join(venvDir, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function findPython() {
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['--version'], { shell: true });
    if (probe.status === 0) return candidate;
  }
  return null;
}

if (!fs.existsSync(venvPython)) {
  const python = findPython();
  if (!python) {
    console.error('[ai] Python 3.10+ not found. Install Python, then re-run `npm run ai`.');
    console.error('[ai] The rest of ProofChain works without the AI service (analysis reports "unavailable").');
    process.exit(1);
  }
  console.log('[ai] Creating virtual environment (first run)…');
  const venv = spawnSync(python, ['-m', 'venv', '.venv'], { cwd: aiDir, stdio: 'inherit', shell: true });
  if (venv.status !== 0) process.exit(venv.status ?? 1);
}

const marker = path.join(venvDir, '.deps-installed');
if (!fs.existsSync(marker)) {
  console.log('[ai] Installing Python dependencies (fastapi, scikit-learn)…');
  const pip = spawnSync(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: aiDir,
    stdio: 'inherit',
    shell: false,
  });
  if (pip.status !== 0) process.exit(pip.status ?? 1);
  fs.writeFileSync(marker, new Date().toISOString());
}

console.log('[ai] Starting FastAPI on http://127.0.0.1:8000');
const server = spawn(venvPython, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
  cwd: aiDir,
  stdio: 'inherit',
  shell: false,
});
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
