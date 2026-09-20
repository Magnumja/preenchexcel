import express from 'express';
import { z } from 'zod';
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { datasets, records } from '../schema';
import { datasetAccess } from '../access';
import { AppError } from '../values';
import { valueSchema } from '../../shared/contracts';
import { runSync } from '../sync';
import { createRecord, csvCell } from '../record-service';
import { uuid, publicDataset } from './shared';
export const router = express.Router();
router.get('/api/datasets/:id', async (req, res) => {
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id));
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(records)
    .where(and(eq(records.datasetId, d.id), isNull(records.deletedAt)));
  res.json({ ...publicDataset(d), recordCount: count.total });
});
router.patch('/api/datasets/:id', async (req, res) => {
  // Após publicar, só rótulo e grupo mudam: tipo, opções e obrigatoriedade exigiriam nova versão.
  const body = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      fields: z
        .array(
          z.object({
            id: z.string().regex(/^c\d+$/),
            label: z.string().trim().min(1).max(100),
            group: z.string().trim().max(100),
          }),
        )
        .optional(),
    })
    .strict()
    .parse(req.body);
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id), true);
  const fields = body.fields
    ? d.fields.map((f) => {
        const patch = body.fields!.find((x) => x.id === f.id);
        return patch ? { ...f, label: patch.label, group: patch.group || 'Informações gerais' } : f;
      })
    : d.fields;
  const [saved] = await db
    .update(datasets)
    .set({ name: body.name ?? d.name, fields })
    .where(eq(datasets.id, d.id))
    .returning();
  res.json(saved);
});
router.patch('/api/datasets/:id/sync', async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id), true);
  if (enabled && (!d.sourceUrl || !d.syncMapping))
    throw new AppError(422, 'Só conjuntos importados de um link do Google Sheets sincronizam.');
  // Quem liga a sincronização passa a ser o autor das alterações que ela aplicar.
  const [saved] = await db
    .update(datasets)
    .set({
      syncEnabled: enabled,
      syncState: { ...(d.syncState ?? {}), userId: res.locals.user.id },
    })
    .where(eq(datasets.id, d.id))
    .returning();
  res.json(saved);
});
router.post('/api/datasets/:id/sync/run', async (req, res) => {
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id), true);
  if (!d.syncState?.userId)
    await db
      .update(datasets)
      .set({ syncState: { userId: res.locals.user.id } })
      .where(eq(datasets.id, d.id));
  res.json(await runSync(d.id));
});
router.post('/api/datasets/:id/records', async (req, res) => {
  const body = z
    .object({
      id: z.string().uuid(),
      values: z.record(z.string().regex(/^c\d+$/), valueSchema),
    })
    .strict()
    .parse(req.body);
  res
    .status(201)
    .json(await createRecord(res.locals.user.id, uuid(req.params.id), body.id, body.values));
});
router.get('/api/datasets/:id/records', async (req, res) => {
  const dataset = await datasetAccess(res.locals.user.id, uuid(req.params.id));
  const q = z
    .object({
      q: z.string().max(200).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      sort: z.string().default(''),
      direction: z.enum(['asc', 'desc']).default('asc'),
      filterField: z.string().default(''),
      filterValue: z.string().max(500).default(''),
      filterMode: z.enum(['exact', 'contains']).default('exact'),
      deleted: z.enum(['0', '1']).default('0'),
    })
    .parse(req.query);
  const conditions = [
    eq(records.datasetId, dataset.id),
    q.deleted === '1' ? isNotNull(records.deletedAt) : isNull(records.deletedAt),
  ];
  if (q.q)
    conditions.push(
      sql`exists (select 1 from jsonb_each_text(${records.values}) as v where position(lower(${q.q}) in lower(v.value))>0)`,
    );
  if (q.filterField) {
    if (!dataset.fields.some((f) => f.id === q.filterField))
      throw new AppError(422, 'Filtro inválido.');
    conditions.push(
      q.filterMode === 'contains'
        ? sql`position(lower(${q.filterValue}) in lower(coalesce(${records.values}->>${q.filterField},'')))>0`
        : sql`${records.values}->>${q.filterField}=${q.filterValue}`,
    );
  }
  const field = dataset.fields.find((f) => f.id === (q.sort || dataset.titleField));
  if (!field) throw new AppError(422, 'Ordenação inválida.');
  const expression = ['number', 'currency'].includes(field.type)
    ? sql`nullif(${records.values}->>${field.id},'')::numeric`
    : sql`${records.values}->>${field.id}`;
  const where = and(...conditions),
    order = q.direction === 'desc' ? desc(expression) : asc(expression);
  // Uma consulta para os dois totais: o filtrado e o de excluídos (independente dos filtros).
  const [count] = await db
    .select({
      total: sql<number>`count(*) filter (where ${where})::int`,
      trash: sql<number>`count(*) filter (where ${records.deletedAt} is not null)::int`,
    })
    .from(records)
    .where(eq(records.datasetId, dataset.id));
  const items = await db
    .select()
    .from(records)
    .where(where)
    .orderBy(order, asc(records.id))
    .limit(25)
    .offset((q.page - 1) * 25);
  // Títulos dos registros referenciados, para a lista mostrar o destino em vez do id.
  const references: Record<string, string> = {};
  const refFields = dataset.fields.filter((f) => f.type === 'reference' && f.reference);
  const ids = [
    ...new Set(
      items.flatMap((r) =>
        refFields.map((f) => r.values[f.id]).filter((v) => typeof v === 'string'),
      ),
    ),
  ] as string[];
  if (ids.length) {
    const targets = await db
      .select({ id: records.id, values: records.values, titleField: datasets.titleField })
      .from(records)
      .innerJoin(datasets, eq(records.datasetId, datasets.id))
      .where(inArray(records.id, ids));
    for (const t of targets) references[t.id] = String(t.values[t.titleField] ?? '');
  }
  res.json({
    items,
    total: count.total,
    page: q.page,
    pageSize: 25,
    references,
    deletedCount: count.trash,
  });
});
router.get('/api/datasets/:id/export', async (req, res) => {
  const d = await datasetAccess(res.locals.user.id, uuid(req.params.id));
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.datasetId, d.id), isNull(records.deletedAt)))
    .orderBy(asc(records.externalKey), asc(records.id));
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
