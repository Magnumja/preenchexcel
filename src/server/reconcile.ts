import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { db } from './db';
import { datasets, projects, records, revisions, links } from './schema';
import type { Confirmation, Field, ReconcilePlan, Value } from '../shared/contracts';
import { AppError } from './values';
import type { ExistingDataset, Prepared } from './importer';
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Existing = typeof records.$inferSelect;
/** Conjuntos do projeto que as abas pretendem atualizar; qualquer outro id é recusado. */
export async function loadExisting(
  tx: Db,
  config: Confirmation,
  workspaceId: string,
): Promise<Map<string, ExistingDataset>> {
  const ids = config.mappings.map((m) => m.datasetId).filter((x): x is string => !!x);
  if (!ids.length) return new Map();
  if (!config.projectId)
    throw new AppError(422, 'Para atualizar conjuntos existentes, importe dentro do projeto.');
  const rows = await tx
    .select({ dataset: datasets })
    .from(datasets)
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(
      and(
        inArray(datasets.id, ids),
        eq(datasets.projectId, config.projectId),
        eq(projects.workspaceId, workspaceId),
      ),
    );
  return new Map(rows.map((r) => [r.dataset.id, r.dataset]));
}
export interface Reconciliation {
  plan: ReconcilePlan;
  inserts: Prepared['rows'];
  updates: { record: Existing; row: Prepared['rows'][number]; values: Record<string, Value> }[];
  conflicts: Reconciliation['updates'];
}
/** Compara as linhas do arquivo com os registros atuais pela chave externa, sem gravar nada. */
export async function planReconcile(
  tx: Db,
  dataset: ExistingDataset,
  mapping: Confirmation['mappings'][number],
  rows: Prepared['rows'],
): Promise<Reconciliation> {
  const targeted = dataset.fields.filter((f) => mapping.fields.some((c) => c.target === f.id));
  await resolveReferences(tx, dataset, targeted, mapping, rows);
  const existing = await tx.select().from(records).where(eq(records.datasetId, dataset.id));
  const byKey = new Map(existing.map((r) => [r.externalKey ?? '', r]));
  const seen = new Set<string>();
  const result: Reconciliation = {
    plan: { inserts: 0, updates: 0, unchanged: 0, conflicts: [], missing: [] },
    inserts: [],
    updates: [],
    conflicts: [],
  };
  for (const row of rows) {
    const key = String(row.values[dataset.keyField!] ?? '');
    seen.add(key);
    const record = byKey.get(key);
    if (!record) {
      result.inserts.push(row);
      result.plan.inserts++;
      continue;
    }
    const values = { ...record.values };
    for (const f of targeted) values[f.id] = row.values[f.id] ?? null;
    if (!record.deletedAt && JSON.stringify(values) === JSON.stringify(record.values)) {
      result.plan.unchanged++;
      continue;
    }
    // Editado no Preenche depois da última importação: o arquivo só sobrescreve se a pessoa pedir.
    // Um registro excluído volta quando o arquivo traz sua chave (é atualização, não conflito).
    const edited = !record.deletedAt && record.version > (record.source.importedVersion ?? 1);
    if (edited) {
      result.conflicts.push({ record, row, values });
      result.plan.conflicts.push(key);
    } else {
      result.updates.push({ record, row, values });
      result.plan.updates++;
    }
  }
  for (const r of existing)
    if (!r.deletedAt && !seen.has(r.externalKey ?? ''))
      result.plan.missing.push(r.externalKey ?? r.id);
  return result;
}
/** Troca chaves externas de referência pelos ids internos dos registros de destino. */
async function resolveReferences(
  tx: Db,
  dataset: ExistingDataset,
  targeted: Field[],
  mapping: Confirmation['mappings'][number],
  rows: Prepared['rows'],
) {
  for (const f of targeted.filter((f) => f.type === 'reference' && f.reference)) {
    const targets = await tx
      .select({ id: records.id, key: records.externalKey })
      .from(records)
      .where(eq(records.datasetId, f.reference!.sheetId));
    const ids = new Map(targets.map((t) => [t.key ?? '', t.id]));
    const col = mapping.fields.find((c) => c.target === f.id);
    for (const row of rows) {
      const v = row.values[f.id];
      if (v === null || v === '' || v === undefined) continue;
      const id = ids.get(String(v));
      if (!id)
        throw new AppError(
          422,
          `${mapping.name} · “${f.label}”: o valor “${String(v).slice(0, 40)}” (linha ${row.row}) não existe no conjunto relacionado.`,
          'VALIDATION_ERROR',
          {
            sheetId: mapping.sheetId,
            fieldId: col?.id ?? null,
            message: 'referência sem correspondência',
          },
        );
      row.values[f.id] = id;
    }
  }
}
/** Valores originais indexados pelo campo do conjunto (a ficha exibe por campo, não por coluna). */
const originalByField = (prepared: Prepared, row: Prepared['rows'][number]) =>
  Object.fromEntries(
    prepared.mapping.fields
      .filter((c) => c.target)
      .map((c) => [c.target!, row.original[c.id] ?? null]),
  );
/** Grava o plano: inclui, atualiza e, conforme a política, sobrescreve conflitos. Nunca apaga. */
export async function applyReconcile(
  tx: Db,
  userId: string,
  dataset: ExistingDataset,
  prepared: Prepared,
  plan: Reconciliation,
) {
  const region = `R${prepared.mapping.headerRow}C${prepared.mapping.startColumn}:R${prepared.mapping.endRow}C${prepared.mapping.endColumn}`;
  const referenceFields = dataset.fields.filter(
    (f) => f.type === 'reference' && prepared.mapping.fields.some((c) => c.target === f.id),
  );
  const inserts = plan.inserts.map((row) => {
    const values: Record<string, Value> = {};
    for (const f of dataset.fields) values[f.id] = row.values[f.id] ?? null;
    return {
      id: randomUUID(),
      datasetId: dataset.id,
      values,
      externalKey: String(values[dataset.keyField!]),
      updatedBy: userId,
      source: {
        file: prepared.sheet.file,
        sheet: prepared.sheet.name,
        row: row.row,
        region,
        mappingVersion: 1,
        original: originalByField(prepared, row),
        importedVersion: 1,
      },
    };
  });
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    await tx.insert(records).values(chunk);
    await tx.insert(revisions).values(
      chunk.map((r) => ({
        recordId: r.id,
        authorId: userId,
        version: 1,
        before: null,
        after: r.values,
        action: 'import' as const,
      })),
    );
    await insertLinks(tx, referenceFields, chunk);
  }
  const changes =
    prepared.mapping.conflicts === 'file' ? [...plan.updates, ...plan.conflicts] : plan.updates;
  for (const { record, row, values } of changes) {
    const [saved] = await tx
      .update(records)
      .set({
        values,
        deletedAt: null,
        version: sql`${records.version}+1`,
        updatedAt: new Date(),
        updatedBy: userId,
        source: {
          ...record.source,
          file: prepared.sheet.file,
          sheet: prepared.sheet.name,
          row: row.row,
          region,
          original: { ...record.source.original, ...originalByField(prepared, row) },
          importedVersion: record.version + 1,
        },
      })
      .where(and(eq(records.id, record.id), eq(records.version, record.version)))
      .returning();
    if (!saved)
      throw new AppError(
        409,
        `O registro “${record.externalKey}” foi alterado durante a importação. Tente novamente.`,
        'CONFLICT',
      );
    await tx.insert(revisions).values({
      recordId: record.id,
      authorId: userId,
      version: saved.version,
      before: record.values,
      after: values,
      action: 'import',
    });
    for (const f of referenceFields)
      await tx.delete(links).where(and(eq(links.recordId, record.id), eq(links.fieldId, f.id)));
    await insertLinks(tx, referenceFields, [{ id: record.id, values }]);
  }
}
async function insertLinks(
  tx: Db,
  referenceFields: Field[],
  items: { id: string; values: Record<string, Value> }[],
) {
  const pending = items.flatMap((r) =>
    referenceFields
      .filter((f) => r.values[f.id])
      .map((f) => ({ recordId: r.id, fieldId: f.id, targetId: String(r.values[f.id]) })),
  );
  for (let i = 0; i < pending.length; i += 200)
    await tx.insert(links).values(pending.slice(i, i + 200));
}
