import express from 'express';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { datasets, records, revisions, user, links } from '../schema';
import { recordAccess } from '../access';
import { valueSchema } from '../../shared/contracts';
import { updateRecord } from '../record-service';
import { uuid } from './shared';
export const router = express.Router();
router.get('/api/records/:id', async (req, res) => {
  const result = await recordAccess(res.locals.user.id, uuid(req.params.id));
  res.json(result);
});
router.patch('/api/records/:id', async (req, res) => {
  const body = z
    .object({
      version: z.number().int().positive(),
      values: z.record(z.string().regex(/^c\d+$/), valueSchema),
    })
    .strict()
    .parse(req.body);
  res.json(await updateRecord(res.locals.user.id, uuid(req.params.id), body.version, body.values));
});
router.get('/api/records/:id/history', async (req, res) => {
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
router.get('/api/records/:id/related', async (req, res) => {
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
