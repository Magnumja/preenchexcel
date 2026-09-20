import express from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import multer from 'multer';
import { db } from '../db';
import { projects, datasets, imports } from '../schema';
import { workspaceAccess } from '../access';
import { AppError } from '../values';
import { parseFiles, proposeMapping, prepareImport, prepareSheet } from '../importer';
import { confirmSchema, mappingSchema } from '../../shared/contracts';
import { publish } from '../publish';
import { loadExisting, planReconcile } from '../reconcile';
import { fetchSheetAsXlsx } from '../google-sheets';
import { uuid, expireDrafts } from './shared';
export const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5, parts: 6 },
});
router.post(
  '/api/workspaces/:wid/imports',
  async (req, res, next) => {
    await workspaceAccess(res.locals.user.id, uuid(req.params.wid), true);
    next();
  },
  upload.array('files', 5),
  async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw new AppError(422, 'Selecione um arquivo.');
    await expireDrafts();
    const diagnosis = await parseFiles(files);
    const [batch] = await db
      .insert(imports)
      .values({ workspaceId: uuid(req.params.wid), authorId: res.locals.user.id, diagnosis })
      .returning();
    res.status(201).json({ id: batch.id, diagnosis });
  },
);
router.post('/api/workspaces/:wid/imports/link', async (req, res) => {
  const wid = uuid(req.params.wid);
  await workspaceAccess(res.locals.user.id, wid, true);
  const { url } = z
    .object({ url: z.string().max(2000) })
    .strict()
    .parse(req.body);
  await expireDrafts();
  const sheet = await fetchSheetAsXlsx(url);
  const diagnosis = await parseFiles([{ originalname: sheet.name, buffer: sheet.buffer }]);
  const [batch] = await db
    .insert(imports)
    .values({
      workspaceId: wid,
      authorId: res.locals.user.id,
      diagnosis,
      sourceUrl: sheet.canonical,
    })
    .returning();
  res.status(201).json({ id: batch.id, diagnosis, sourceUrl: sheet.canonical, name: sheet.name });
});
router.post('/api/imports/:id/mapping', async (req, res) => {
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
router.post('/api/imports/:id/validate', async (req, res) => {
  const body = z
    .object({ mapping: mappingSchema, locale: z.enum(['pt-BR', 'en-US']).default('pt-BR') })
    .parse(req.body);
  const [b] = await db
    .select()
    .from(imports)
    .where(eq(imports.id, uuid(req.params.id)));
  if (!b?.diagnosis) throw new AppError(404, 'Rascunho não encontrado.');
  await workspaceAccess(res.locals.user.id, b.workspaceId, true);
  const sheet = b.diagnosis.sheets.find((s) => s.id === body.mapping.sheetId);
  if (!sheet) throw new AppError(422, 'Aba desconhecida.');
  let existing;
  if (body.mapping.datasetId) {
    const [d] = await db
      .select({ dataset: datasets, workspaceId: projects.workspaceId })
      .from(datasets)
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(eq(datasets.id, body.mapping.datasetId));
    if (!d || d.workspaceId !== b.workspaceId)
      throw new AppError(422, 'O conjunto a atualizar não pertence a este espaço.');
    existing = d.dataset;
  }
  const { rows, issues } = prepareSheet(sheet, body.mapping, body.locale, true, existing);
  res.json({ count: rows.length, issues });
});
router.post('/api/imports/:id/preview', async (req, res) => {
  const config = confirmSchema.parse(req.body);
  const [b] = await db
    .select()
    .from(imports)
    .where(eq(imports.id, uuid(req.params.id)));
  if (!b?.diagnosis) throw new AppError(404, 'Rascunho não encontrado.');
  await workspaceAccess(res.locals.user.id, b.workspaceId, true);
  const existing = await loadExisting(db, config, b.workspaceId);
  const prepared = prepareImport(b.diagnosis, config, existing);
  const out = [];
  for (const p of prepared) {
    const fields = p.existing
      ? p.existing.fields.filter((f) => p.mapping.fields.some((c) => c.target === f.id))
      : p.mapping.fields;
    const plan = p.existing ? (await planReconcile(db, p.existing, p.mapping, p.rows)).plan : null;
    out.push({
      name: p.existing ? p.existing.name : p.mapping.name,
      count: p.rows.length,
      fields,
      samples: p.rows.slice(0, 3).map((r) => r.values),
      outsideRows: p.sheet.rows.length - (p.mapping.endRow - p.mapping.headerRow),
      blankRows: p.mapping.endRow - p.mapping.headerRow - p.rows.length,
      existing: !!p.existing,
      plan: plan && {
        ...plan,
        conflicts: plan.conflicts.slice(0, 50),
        missing: plan.missing.slice(0, 50),
        conflictCount: plan.conflicts.length,
        missingCount: plan.missing.length,
      },
    });
  }
  res.json(out);
});
router.post('/api/imports/:id/confirm', async (req, res) =>
  res.json(await publish(res.locals.user.id, uuid(req.params.id), confirmSchema.parse(req.body))),
);
