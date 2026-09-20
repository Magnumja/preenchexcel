import express from 'express';
import { z } from 'zod';
import { eq, desc, sql, inArray, getTableColumns } from 'drizzle-orm';
import { db } from '../db';
import { projects, datasets, records, revisions, imports, user, links } from '../schema';
import { workspaceAccess } from '../access';
import { AppError } from '../values';
import { uuid, publicDataset } from './shared';
export const router = express.Router();
router.get('/api/workspaces/:wid/projects', async (req, res) => {
  const wid = uuid(req.params.wid);
  await workspaceAccess(res.locals.user.id, wid);
  res.json(
    await db
      .select({
        ...getTableColumns(projects),
        datasetCount: sql<number>`(select count(*)::int from dataset where project_id=project.id)`,
        recordCount: sql<number>`(select count(*)::int from record r join dataset d on r.dataset_id=d.id where d.project_id=project.id)`,
      })
      .from(projects)
      .where(eq(projects.workspaceId, wid))
      .orderBy(desc(projects.createdAt)),
  );
});
router.get('/api/projects/:id', async (req, res) => {
  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, uuid(req.params.id)));
  if (!p) throw new AppError(404, 'Projeto não encontrado.');
  await workspaceAccess(res.locals.user.id, p.workspaceId);
  const sets = await db
    .select({
      ...getTableColumns(datasets),
      recordCount: sql<number>`(select count(*)::int from record where dataset_id=dataset.id)`,
    })
    .from(datasets)
    .where(eq(datasets.projectId, p.id));
  res.json({ ...p, datasets: sets.map(publicDataset) });
});
router.delete('/api/projects/:id', async (req, res) => {
  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, uuid(req.params.id)));
  if (!p) throw new AppError(404, 'Projeto não encontrado.');
  const member = await workspaceAccess(res.locals.user.id, p.workspaceId, true);
  if (member.role !== 'owner') throw new AppError(403, 'Somente o proprietário exclui projetos.');
  // Exclusão definitiva, em uma transação: registros, histórico, vínculos e conjuntos.
  await db.transaction(async (tx) => {
    const sets = await tx
      .select({ id: datasets.id })
      .from(datasets)
      .where(eq(datasets.projectId, p.id));
    const ids = sets.map((d) => d.id);
    if (ids.length) {
      const recs = tx
        .select({ id: records.id })
        .from(records)
        .where(inArray(records.datasetId, ids));
      await tx.delete(links).where(inArray(links.recordId, recs));
      await tx.delete(links).where(inArray(links.targetId, recs));
      await tx.delete(revisions).where(inArray(revisions.recordId, recs));
      await tx.delete(records).where(inArray(records.datasetId, ids));
      await tx.delete(datasets).where(inArray(datasets.id, ids));
    }
    await tx
      .update(imports)
      .set({ publishedProjectId: null, mapping: null })
      .where(eq(imports.publishedProjectId, p.id));
    await tx.delete(projects).where(eq(projects.id, p.id));
  });
  res.status(204).end();
});
router.patch('/api/projects/:id', async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100), description: z.string().max(500) })
    .strict()
    .parse(req.body);
  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, uuid(req.params.id)));
  if (!p) throw new AppError(404, 'Projeto não encontrado.');
  await workspaceAccess(res.locals.user.id, p.workspaceId, true);
  const [saved] = await db.update(projects).set(body).where(eq(projects.id, p.id)).returning();
  res.json(saved);
});
router.get('/api/projects/:id/imports', async (req, res) => {
  const [p] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, uuid(req.params.id)));
  if (!p) throw new AppError(404, 'Projeto não encontrado.');
  await workspaceAccess(res.locals.user.id, p.workspaceId);
  const rows = await db
    .select({
      id: imports.id,
      createdAt: imports.createdAt,
      author: user.name,
      mapping: imports.mapping,
    })
    .from(imports)
    .innerJoin(user, eq(imports.authorId, user.id))
    .where(eq(imports.publishedProjectId, p.id))
    .orderBy(desc(imports.createdAt));
  // Só metadados do lote: nomes de arquivos/abas e o papel de cada uma. Nenhum valor de célula.
  res.json(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      author: r.author,
      locale: r.mapping?.locale,
      sheets: (r.mapping?.mappings ?? []).map((m) => ({
        name: m.name,
        role: m.role,
        fields: m.fields.length,
      })),
    })),
  );
});
