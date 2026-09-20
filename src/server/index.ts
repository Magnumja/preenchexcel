import express from 'express';
import { resolve } from 'node:path';
import { app } from './app';
import { pool } from './db';
import { startSyncScheduler } from './sync';
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist/client')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
}
const syncMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
if (syncMinutes > 0) startSyncScheduler(syncMinutes);
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  () => console.log('API pronta na porta ' + (process.env.PORT || 3001)),
);
process.on('SIGTERM', () =>
  server.close(() => {
    void pool.end();
  }),
);
