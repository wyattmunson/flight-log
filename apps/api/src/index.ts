import './env';
import { createApp } from './app';
import { prisma } from './db';
import { env } from './env';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port}`);
});

const shutdown = () => {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
