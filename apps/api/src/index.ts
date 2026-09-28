import { env } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { getDeployment, isChainUp, serverSignerAddress } from './services/chain.js';
import { aiServiceUp } from './services/ai.js';
import { ipfsService } from './services/storage.js';
import { startIndexer, stopIndexer } from './services/indexer.js';

async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.error(
      'Database is not ready. Run `npm run db:setup` from the repo root (creates the SQLite file, pushes the schema, seeds users).'
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.API_PORT, async () => {
    const [chainUp, aiUp] = await Promise.all([isChainUp(), aiServiceUp()]);
    const deployment = getDeployment();
    console.log('─'.repeat(60));
    console.log(`ProofChain API      http://127.0.0.1:${env.API_PORT}`);
    console.log(`Chain (${env.NETWORK_NAME})   ${chainUp ? `up @ ${env.RPC_URL}` : 'DOWN — run `npm run chain`'}`);
    console.log(`Registry contract   ${deployment?.contractAddress ?? 'not deployed — run `npm run deploy`'}`);
    console.log(`Server signer       ${serverSignerAddress() ?? 'disabled'}`);
    console.log(`Storage mode        ${ipfsService.modeLabel()}`);
    console.log(`AI service          ${aiUp ? `up @ ${env.AI_SERVICE_URL}` : 'down (optional) — run `npm run ai`'}`);
    console.log('─'.repeat(60));
  });

  startIndexer();

  const shutdown = async () => {
    stopIndexer();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
