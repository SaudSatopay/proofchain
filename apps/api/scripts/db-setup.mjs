/**
 * One-shot database setup: loads the root .env (if present), defaults to
 * the zero-config SQLite database, then runs `prisma generate`,
 * `prisma db push` and the user seed. Wrapping the Prisma CLI here keeps
 * the whole monorepo on a single root .env file.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootEnv = path.join(apiDir, '..', '..', '.env');

if (fs.existsSync(rootEnv)) {
  const { config } = await import('dotenv');
  config({ path: rootEnv });
}
// Relative SQLite paths resolve against the prisma/ schema directory.
process.env.DATABASE_URL ||= 'file:./data/proofchain.db';

fs.mkdirSync(path.join(apiDir, 'prisma', 'data'), { recursive: true });

const run = (args) => {
  console.log(`\n> prisma ${args.join(' ')}`);
  const result = spawnSync('npx', ['prisma', ...args], {
    cwd: apiDir,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(['generate']);
run(['db', 'push']);
run(['db', 'seed']);
console.log('\nDatabase ready.');
