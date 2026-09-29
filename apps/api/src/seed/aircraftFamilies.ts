import '../env';
import { prisma } from '../db';
import { syncAircraftFamilies } from '../dal/reference';

syncAircraftFamilies()
  .then(({ families, assigned, unmatched }) => {
    console.log(`[aircraft-families] ${families} families, ${assigned} types assigned`);
    if (unmatched.length) console.log(`[aircraft-families] no family for: ${unmatched.join(', ')}`);
  })
  .catch((e) => {
    console.error(`[aircraft-families] failed: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
