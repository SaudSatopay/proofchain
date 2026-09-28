/**
 * Seeds application users (one per role) for local development.
 * These are APPLICATION accounts only — blockchain ownership is held by
 * wallet addresses and is deliberately separate.
 *
 * Demo credentials (documented in the README):
 *   admin@proofchain.local      / proofchain-demo   (ADMIN)
 *   researcher@proofchain.local / proofchain-demo   (RESEARCHER)
 *   developer@proofchain.local  / proofchain-demo   (DEVELOPER)
 *   auditor@proofchain.local    / proofchain-demo   (AUDITOR)
 *   viewer@proofchain.local     / proofchain-demo   (VIEWER)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USERS = [
  { email: 'admin@proofchain.local', displayName: 'Registry Admin', role: 'ADMIN' },
  { email: 'researcher@proofchain.local', displayName: 'Dana Researcher', role: 'RESEARCHER' },
  { email: 'developer@proofchain.local', displayName: 'Sam Developer', role: 'DEVELOPER' },
  { email: 'auditor@proofchain.local', displayName: 'Iris Auditor', role: 'AUDITOR' },
  { email: 'viewer@proofchain.local', displayName: 'Vic Viewer', role: 'VIEWER' },
];

async function main() {
  const passwordHash = await bcrypt.hash('proofchain-demo', 10);
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, displayName: user.displayName },
      create: { ...user, passwordHash },
    });
  }
  console.log(`Seeded ${USERS.length} application users (password: proofchain-demo).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
