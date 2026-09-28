import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './errors.js';
import { attachUser } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { artifactsRouter } from './routes/artifacts.js';
import {
  aiRouter,
  blockchainRouter,
  dashboardRouter,
  demoRouter,
  networkRouter,
  storageRouter,
  verifyRouter,
} from './routes/misc.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
      credentials: false,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(attachUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'proofchain-api' }));
  app.use('/api/auth', authRouter);
  app.use('/api/artifacts', artifactsRouter);
  app.use('/api/verify', verifyRouter);
  app.use('/api/blockchain', blockchainRouter);
  app.use('/api/network', networkRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api/storage', storageRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
  });
  app.use(errorHandler);
  return app;
}
