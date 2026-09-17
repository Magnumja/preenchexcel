import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { records, revisions, links, datasets } from './schema';
import { recordAccess } from './access';
import { AppError, validateValues } from './values';
import type { Value } from '../shared/contracts';
export async function updateRecord(
  userId: string,
  id: string,
  version: number,
  patch: Record<string, Value>,
) {
  const { record, dataset } = await recordAccess(userId, id, true);
  const values = validateValues(patch, dataset.fields, record.values);
  if (dataset.keyField && (values[dataset.keyField] === null || values[dataset.keyField] === ''))
    throw new AppError(422, 'A chave externa não pode ficar vazia.');
  for (const f of dataset.fields.filter((f) => f.type === 'reference'))
    if (
      values[f.id] &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(values[f.id]))
    )
      throw new AppError(422, `Referência inválida em “${f.label}”.`);
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .update(records)
      .set({
        values,
        version: sql`${records.version}+1`,
        updatedAt: new Date(),
        updatedBy: userId,
        externalKey: dataset.keyField ? String(values[dataset.keyField] ?? '') : null,
      })
      .where(and(eq(records.id, id), eq(records.version, version)))
      .returning();
    if (!saved)
      throw new AppError(
        409,
        'Outra pessoa alterou este registro. Seu preenchimento foi preservado. Reabra a versão atual para comparar antes de salvar.',
        'VERSION_CONFLICT',
      );
    for (const f of dataset.fields.filter(
      (f) => f.type === 'reference' && Object.hasOwn(patch, f.id),
    )) {
      await tx.delete(links).where(and(eq(links.recordId, id), eq(links.fieldId, f.id)));
      const targetId = values[f.id];
      if (targetId !== null && targetId !== '') {
        const [target] = await tx
          .select({ id: records.id, projectId: datasets.projectId })
          .from(records)
          .innerJoin(datasets, eq(records.datasetId, datasets.id))
          .where(
            and(eq(records.id, String(targetId)), eq(records.datasetId, f.reference!.sheetId)),
          );
        if (!target || target.projectId !== dataset.projectId)
          throw new AppError(422, `Referência inválida em “${f.label}”.`);
        await tx.insert(links).values({ recordId: id, fieldId: f.id, targetId: target.id });
      }
    }
    await tx
      .insert(revisions)
      .values({
        recordId: id,
        authorId: userId,
        version: saved.version,
        before: record.values,
        after: values,
      });
    return saved;
  });
}
export const csvCell = (value: Value | undefined) => {
  let s =
    value === null || value === undefined
      ? ''
      : Array.isArray(value)
        ? value.join(';')
        : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
