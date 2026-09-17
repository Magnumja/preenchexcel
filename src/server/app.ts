import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { and, eq, desc, asc, sql, lt, isNull, getTableColumns } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import {
  workspaces,
  members,
  projects,
  datasets,
  records,
  revisions,
  imports,
  user,
  links,
} from './schema';
import { workspaceAccess, datasetAccess, recordAccess } from './access';
import { AppError } from './values';
import { parseFiles, proposeMapping, prepareImport } from './importer';
import { confirmSchema, valueSchema } from '../shared/contracts';
import { publish } from './publish';
import { updateRecord, csvCell } from './record-service';
const uuid = (v: unknown) => z.string().uuid().parse(v);
const nameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
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
    req.headers.origin !== process.env.APP_ORIGIN
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
app.get('/api/workspaces', async (_req, res) => {
  const list = await db
    .select({ id: workspaces.id, name: workspaces.name, role: members.role })
    .from(workspaces)
    .innerJoin(members, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, res.locals.user.id));
  res.json(list);
});
app.post('/api/workspaces', async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const w = await db.transaction(async (tx) => {
    const [w] = await tx.insert(workspaces).values({ name }).returning();
    await tx
      .insert(members)
      .values({ workspaceId: w.id, userId: res.locals.user.id, role: 'owner' });
    return { ...w, role: 'owner' };
  });
  res.status(201).json(w);
});
app.get('/api/workspaces/:wid/members', async (req, res) => {
  await workspaceAccess(res.locals.user.id, uuid(req.params.wid));
  res.json(
    await db
      .select({ id: user.id, name: user.name, email: user.email, role: members.role })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(eq(members.workspaceId, uuid(req.params.wid))),
  );
});
app.post('/api/workspaces/:wid/members', async (req, res) => {
  const wid = uuid(req.params.wid),
    member = await workspaceAccess(res.locals.user.id, wid, true);
  if (member.role !== 'owner') throw new AppError(403, 'Somente o proprietário gerencia membros.');
  const body = z
    .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']) })
    .strict()
    .parse(req.body);
  const [u] = await db.select().from(user).where(eq(user.email, body.email.toLowerCase()));
  if (!u) throw new AppError(422, 'Esta pessoa precisa criar uma conta antes de ser adicionada.');
  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, wid), eq(members.userId, u.id)));
  if (existing?.role === 'owner')
    throw new AppError(422, 'O proprietário não pode ser alterado aqui.');
  await db
    .insert(members)
    .values({ workspaceId: wid, userId: u.id, role: body.role })
    .onConflictDoUpdate({
      target: [members.workspaceId, members.userId],
      set: { role: body.role },
    });
  res.json({ ok: true });
});
app.get('/api/workspaces/:wid/projects', async (req, res) => {
  const wid = uuid(req.params.wid);
  await workspaceAccess(res.locals.user.id, wid);
  res.json(
    await db
      .select({
        ...getTableColumns(projects),
        datasetCount: sql<number>`(select count(*)::int from dataset where project_id=${projects.id})`,
        recordCount: sql<number>`(select count(*)::int from record r join dataset d on r.dataset_id=d.id where d.project_id=${projects.id})`,
      })
      .from(projects)
      .where(eq(projects.workspaceId, wid))
      .orderBy(desc(projects.createdAt)),
  );
});
app.get('/api/projects/:id', async (req, res) => {
  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, uuid(req.params.id)));
  if (!p) throw new AppError(404, 'Projeto não encontrado.');
  await workspaceAccess(res.locals.user.id, p.workspaceId);
  const sets = await db
    .select({
      ...getTableColumns(datasets),
      recordCount: sql<number>`(select count(*)::int from record where dataset_id=${datasets.id})`,
    })
    .from(datasets)
    .where(eq(datasets.projectId, p.id));
  res.json({ ...p, datasets: sets });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5, parts: 6 },
});
app.post(
  '/api/workspaces/:wid/imports',
  async (req, res, next) => {
    await workspaceAccess(res.locals.user.id, uuid(req.params.wid), true);
    next();
  },
  upload.array('files', 5),
  async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw new AppError(422, 'Selecione um arquivo.');
    await db
      .delete(imports)
      .where(
        and(
          isNull(imports.publishedProjectId),
          lt(imports.createdAt, new Date(Date.now() - 86400000)),
        ),
      );
    const diagnosis = await parseFiles(files);
    const [batch] = await db
      .insert(imports)
      .values({ workspaceId: uuid(req.params.wid), authorId: res.locals.user.id, diagnosis })
      .returning();
    res.status(201).json({ id: batch.id, diagnosis });
  },
);
app.post('/api/imports/:id/mapping', async (req, res) => {
  const body = z
    .object({ sheetId: z.string(), headerRow: z.number().int().min(1).max(10001) })
    .parse(req.body);
  const [b] = await db
    .select()
    .from(imports)
    .where(eq(imports.id, uuid(req.params.id)));
  if (!b?.diagnosis) throw new AppError(404, 'Rascunho não encontrado.');
  await workspaceAccess(res.locals.user.id, b.workspaceId, true);
  const sheet = b.diagnosis.sheets.find((s) => s.id === body.sheetId);
  if (!sheet || body.headerRow > sheet.rows.length) throw new AppError(422, 'Cabeçalho inválido.');
  res.json(proposeMapping(sheet, body.headerRow));
});
app.post('/api/imports/:id/preview', async (req, res) => {
  const config = confirmSchema.parse(req.body);
  const [b] = await db
    .select()
    .from(imports)
    .where(eq(imports.id, uuid(req.params.id)));
  if (!b?.diagnosis) throw new AppError(404, 'Rascunho não encontrado.');
  await workspaceAccess(res.locals.user.id, b.workspaceId, true);
  const prepared = prepareImport(b.diagnosis, config);
  res.json(
    prepared.map((p) => ({
      name: p.mapping.name,
      count: p.rows.length,
      fields: p.mapping.fields,
      samples: p.rows.slice(0, 3).map((r) => r.values),
      outsideRows: p.sheet.rows.length - (p.mapping.endRow - p.mapping.headerRow),
      blankRows: p.mapping.endRow - p.mapping.headerRow - p.rows.length,
    })),
  );
});
app.post('/api/imports/:id/confirm', async (req, res) =>
  res.json(await publish(res.locals.user.id, uuid(req.params.id), confirmSchema.parse(req.body))),
);
app.get('/api/datasets/:id/records', async (req, res) => {
  const dataset = await datasetAccess(res.locals.user.id, uuid(req.params.id));
  const q = z
    .object({
      q: z.string().max(200).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      sort: z.string().default(''),
      direction: z.enum(['asc', 'desc']).default('asc'),
      filterField: z.string().default(''),
      filterValue: z.string().max(500).default(''),
    })
    .parse(req.query);
  const conditions = [eq(records.datasetId, dataset.id)];
  if (q.q)
    conditions.push(
      sql`exists (select 1 from jsonb_each_text(${records.values}) as v where position(lower(${q.q}) in lower(v.value))>0)`,
    );
  if (q.filterField) {
    if (!dataset.fields.some((f) => f.id === q.filterField))
      throw new AppError(422, 'Filtro inválido.');
    conditions.push(sql`${records.values}->>${q.filterField}=${q.filterValue}`);
  }
  const field = dataset.fields.find((f) => f.id === (q.sort || dataset.titleField));
  if (!field) throw new AppError(422, 'Ordenação inválida.');
  const expression = ['number', 'currency'].includes(field.type)
    ? sql`nullif(${records.values}->>${field.id},'')::numeric`
    : sql`${records.values}->>${field.id}`;
  const where = and(...conditions),
    order = q.direction === 'desc' ? desc(expression) : asc(expression);
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(records)
    .where(where);
  const items = await db
    .select()
    .from(records)
    .where(where)
    .orderBy(order, asc(records.id))
    .limit(25)
    .offset((q.page - 1) * 25);
  res.json({ items, total: count.total, page: q.page, pageSize: 25 });
});
app.get('/api/records/:id', async (req, res) => {
  const result = await recordAccess(res.locals.user.id, uuid(req.params.id));
  res.json(result);
});
app.patch('/api/records/:id', async (req, res) => {
  const body = z
    .object({
      version: z.number().int().positive(),
      values: z.record(z.string().regex(/^c\d+$/), valueSchema),
    })
    .strict()
    .parse(req.body);
  res.json(await updateRecord(res.locals.user.id, uuid(req.params.id), body.version, body.values));
});
app.get('/api/records/:id/history', async (req, res) => {
  const { record } = await recordAccess(res.locals.user.id, uuid(req.params.id));
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  res.json(
    await db
      .select({
        id: revisions.id,
        author: user.name,
        createdAt: revisions.createdAt,
        version: revisions.version,
        before: revisions.before,
        after: revisions.after,
      })
      .from(revisions)
      .innerJoin(user, eq(revisions.authorId, user.id))
      .where(eq(revisions.recordId, record.id))
      .orderBy(desc(revisions.version))
      .limit(25)
      .offset((page - 1) * 25),
  );
});
app.get('/api/records/:id/related', async (req, res) => {
  const { record } = await recordAccess(res.locals.user.id, uuid(req.params.id));
  res.json(
    await db
      .select({
        id: records.id,
        datasetId: datasets.id,
        dataset: datasets.name,
        values: records.values,
        titleField: datasets.titleField,
      })
      .from(links)
      .innerJoin(records, eq(records.id, links.recordId))
      .innerJoin(datasets, eq(datasets.id, records.datasetId))
      .where(eq(links.targetId, record.id))
      .limit(100),
  );
});
app.get('/api/datasets/:id/export', async (req, res) => {
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id));
  const rows = await db
    .select()
    .from(records)
    .where(eq(records.datasetId, d.id))
    .orderBy(asc(records.id));
  const targets = new Map<string, string>();
  for (const f of d.fields.filter((f) => f.type === 'reference')) {
    const target = await datasetAccess(res.locals.user.id, f.reference!.sheetId);
    const items = await db.select().from(records).where(eq(records.datasetId, target.id));
    for (const r of items)
      targets.set(r.id, String(r.values[target.keyField || target.titleField] ?? ''));
  }
  const csv = [
    d.fields.map((f) => csvCell(f.label)).join(','),
    ...rows.map((r) =>
      d.fields
        .map((f) =>
          csvCell(
            f.type === 'reference' && r.values[f.id]
              ? targets.get(String(r.values[f.id]))
              : r.values[f.id],
          ),
        )
        .join(','),
    ),
  ].join('\r\n');
  res
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set(
      'Content-Disposition',
      `attachment; filename="dados.csv"; filename*=UTF-8''${encodeURIComponent(d.name)}.csv`,
    )
    .send('\uFEFF' + csv);
});
app.use('/api', (_req, _res, next) =>
  next(new AppError(404, 'Endpoint não encontrado.', 'NOT_FOUND')),
);
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof z.ZodError) {
      res
        .status(422)
        .json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Confira os campos enviados.',
            details: err.flatten(),
          },
        });
      return;
    }
    if (err instanceof multer.MulterError) {
      res
        .status(413)
        .json({
          error: {
            code: 'UPLOAD_LIMIT',
            message: 'Envie até 5 arquivos, cada um com no máximo 5 MB.',
          },
        });
      return;
    }
    const e = err as { code?: string; cause?: { code?: string }; status?: number };
    if (e.code === '23505' || e.cause?.code === '23505') {
      res
        .status(409)
        .json({
          error: {
            code: 'DUPLICATE',
            message: 'Esta chave já está em uso. Escolha um identificador único.',
          },
        });
      return;
    }
    if (e.status === 400 || e.status === 413) {
      res
        .status(e.status)
        .json({
          error: { code: 'INVALID_BODY', message: 'Requisição inválida ou acima do limite.' },
        });
      return;
    }
    console.error('request_failed', { code: e.code ?? e.cause?.code ?? 'INTERNAL_ERROR' });
    res
      .status(500)
      .json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Não foi possível concluir. Seus dados foram preservados; tente novamente.',
        },
      });
  },
);
