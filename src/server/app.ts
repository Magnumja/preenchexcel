import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { auth, allowedOrigins } from './auth';
import { db } from './db';
import { AppError } from './values';
import { router as workspacesRouter } from './routes/workspaces';
import { router as projectsRouter } from './routes/projects';
import { router as datasetsRouter } from './routes/datasets';
import { router as importsRouter } from './routes/imports';
import { router as recordsRouter } from './routes/records';
export const app = express();
app.disable('x-powered-by');
app.use(
  helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false }),
);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', async (_req, res) => {
  await db.execute(sql`select 1`);
  res.json({ status: 'ok' });
});
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '2mb' }));
app.use('/api', async (req, res, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session)
    throw new AppError(
      401,
      'Sua sessão expirou. Entre novamente; o preenchimento permanece nesta tela.',
      'UNAUTHENTICATED',
    );
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    !allowedOrigins.includes(req.headers.origin ?? '')
  )
    throw new AppError(403, 'Origem da requisição não autorizada.', 'FORBIDDEN');
  res.locals.user = session.user;
  next();
});
app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: 240,
    keyGenerator: (_req, res) => res.locals.user.id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }),
);
app.get('/api/me', (_req, res) => res.json(res.locals.user));
for (const r of [workspacesRouter, projectsRouter, datasetsRouter, importsRouter, recordsRouter])
  app.use(r);
app.use('/api', (_req, _res, next) =>
  next(new AppError(404, 'Endpoint não encontrado.', 'NOT_FOUND')),
);
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Confira os campos enviados.',
          details: err.flatten(),
        },
      });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(413).json({
        error: {
          code: 'UPLOAD_LIMIT',
          message: 'Envie até 5 arquivos, cada um com no máximo 5 MB.',
        },
      });
      return;
    }
    const e = err as { code?: string; cause?: { code?: string }; status?: number };
    if (e.code === '23505' || e.cause?.code === '23505') {
      res.status(409).json({
        error: {
          code: 'DUPLICATE',
          message: 'Esta chave já está em uso. Escolha um identificador único.',
        },
      });
      return;
    }
    if (e.status === 400 || e.status === 413) {
      res.status(e.status).json({
        error: { code: 'INVALID_BODY', message: 'Requisição inválida ou acima do limite.' },
      });
      return;
    }
    console.error('request_failed', {
      code: e.code ?? e.cause?.code ?? 'INTERNAL_ERROR',
      error: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err),
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Não foi possível concluir. Seus dados foram preservados; tente novamente.',
      },
    });
  },
);
