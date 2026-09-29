import '../env';
import { prisma } from '../db';
import { seedReference } from './reference';

const ifEmpty = process.argv.includes('--if-empty');

seedReference(prisma, { ifEmpty })
  .then(() => console.log('[seed] done'))
  .catch((e) => {
    console.error(`[seed] failed: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
