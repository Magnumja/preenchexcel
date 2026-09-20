import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { imports, projects, datasets, records, revisions, links } from './schema';
import type { Confirmation, Value } from '../shared/contracts';
import { AppError } from './values';
import { prepareImport } from './importer';
import { loadExisting, planReconcile, applyReconcile } from './reconcile';
import { syncMappingFor } from './sync';
import { workspaceAccess } from './access';
export async function publish(userId: string, batchId: string, config: Confirmation) {
  const [batch] = await db.select().from(imports).where(eq(imports.id, batchId));
  if (!batch) throw new AppError(404, 'Importação não encontrada.', 'NOT_FOUND');
  await workspaceAccess(userId, batch.workspaceId, true);
  const hash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return db.transaction(async (tx) => {
    // The row lock is also the idempotency claim: concurrent retries serialize here.
    await tx.execute(sql`select id from import_batch where id=${batchId} for update`);
    const [locked] = await tx.select().from(imports).where(eq(imports.id, batchId));
    if (locked.publishedProjectId) {
      if (locked.requestHash !== hash)
        throw new AppError(409, 'Este lote já foi publicado com outra configuração.', 'CONFLICT');
      return { projectId: locked.publishedProjectId };
    }
    if (!locked.diagnosis || Date.now() - locked.createdAt.getTime() > 86400000)
      throw new AppError(410, 'Rascunho expirado. Importe o arquivo novamente.');
    const existing = await loadExisting(tx, config, batch.workspaceId);
    const prepared = prepareImport(locked.diagnosis, config, existing);
    let projectId = config.projectId;
    if (projectId) {
      const [p] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, batch.workspaceId)));
      if (!p) throw new AppError(404, 'Projeto não encontrado.');
    } else {
      const [p] = await tx
        .insert(projects)
        .values({
          workspaceId: batch.workspaceId,
          name: config.name,
          description: config.description,
        })
        .returning();
      projectId = p.id;
    }
    // Abas que atualizam conjuntos existentes seguem pela reconciliação; as demais criam conjuntos.
    for (const p of prepared.filter((p) => p.existing)) {
      const plan = await planReconcile(tx, p.existing!, p.mapping, p.rows);
      await applyReconcile(tx, userId, p.existing!, p, plan);
      if (locked.sourceUrl)
        await tx
          .update(datasets)
          .set({
            sourceUrl: locked.sourceUrl,
            syncMapping: syncMappingFor(p.mapping, p.existing!.id, p.sheet.name),
            syncState: { ...(p.existing as { syncState?: { userId: string } }).syncState, userId },
          })
          .where(eq(datasets.id, p.existing!.id));
    }
    const creating = prepared.filter((p) => !p.existing);
    const datasetIds = new Map(creating.map((p) => [p.mapping.sheetId, randomUUID()]));
    const ids = new Map<string, string>();
    const planned = creating.map((p) => ({
      ...p,
      rows: p.rows.map((r) => {
        const id = randomUUID();
        if (p.mapping.keyField) ids.set(`${p.mapping.sheetId}:${r.values[p.mapping.keyField]}`, id);
        return { ...r, id };
      }),
    }));
    for (const p of planned) {
      const fields = p.mapping.fields.map((f) => ({
        ...f,
        reference:
          f.type === 'reference' && f.reference
            ? { ...f.reference, sheetId: datasetIds.get(f.reference.sheetId)! }
            : undefined,
      }));
      await tx.insert(datasets).values({
        id: datasetIds.get(p.mapping.sheetId),
        projectId: projectId!,
        name: p.mapping.name,
        role: p.mapping.role,
        fields,
        keyField: p.mapping.keyField,
        titleField: p.mapping.titleField,
        sourceUrl: locked.sourceUrl,
        syncMapping: locked.sourceUrl
          ? syncMappingFor(p.mapping, datasetIds.get(p.mapping.sheetId)!, p.sheet.name)
          : null,
        syncState: locked.sourceUrl ? { userId } : null,
      });
    }
    const pendingLinks: { recordId: string; fieldId: string; targetId: string }[] = [];
    for (const p of planned) {
      const items = p.rows.map((r) => {
        const values: Record<string, Value> = { ...r.values };
        for (const f of p.mapping.fields.filter((f) => f.type === 'reference'))
          if (values[f.id] !== null && values[f.id] !== '') {
            const targetId = ids.get(`${f.reference!.sheetId}:${values[f.id]}`)!;
            values[f.id] = targetId;
            pendingLinks.push({ recordId: r.id, fieldId: f.id, targetId });
          }
        return {
          id: r.id,
          datasetId: datasetIds.get(p.mapping.sheetId)!,
          values,
          externalKey: p.mapping.keyField ? String(values[p.mapping.keyField]) : null,
          updatedBy: userId,
          source: {
            file: p.sheet.file,
            sheet: p.sheet.name,
            row: r.row,
            region: `R${p.mapping.headerRow}C${p.mapping.startColumn}:R${p.mapping.endRow}C${p.mapping.endColumn}`,
            mappingVersion: 1,
            original: r.original,
          },
        };
      });
      for (let i = 0; i < items.length; i += 200) {
        const chunk = items.slice(i, i + 200);
        await tx.insert(records).values(chunk);
        await tx.insert(revisions).values(
          chunk.map((r) => ({
            recordId: r.id,
            authorId: userId,
            version: 1,
            before: null,
            after: r.values,
          })),
        );
      }
    }
    for (let i = 0; i < pendingLinks.length; i += 200)
      await tx.insert(links).values(pendingLinks.slice(i, i + 200));
    await tx
      .update(imports)
      .set({ diagnosis: null, mapping: config, publishedProjectId: projectId, requestHash: hash })
      .where(eq(imports.id, batchId));
    return { projectId };
  });
}
