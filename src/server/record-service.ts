import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { records, revisions, links, datasets } from './schema';
import { datasetAccess, recordAccess } from './access';
import { AppError, validateValues } from './values';
import type { Field, Value } from '../shared/contracts';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const isUuid = (v: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
function checkKey(dataset: { keyField: string | null }, values: Record<string, Value>) {
  if (dataset.keyField && (values[dataset.keyField] === null || values[dataset.keyField] === ''))
    throw new AppError(422, 'A chave externa não pode ficar vazia.');
}
/** Recria os vínculos dos campos de referência informados, validando destino e projeto. */
async function syncLinks(
  tx: Tx,
  recordId: string,
  projectId: string,
  fields: Field[],
  values: Record<string, Value>,
) {
  for (const f of fields) {
    await tx.delete(links).where(and(eq(links.recordId, recordId), eq(links.fieldId, f.id)));
    const targetId = values[f.id];
    if (targetId === null || targetId === '' || targetId === undefined) continue;
    const [target] = await tx
      .select({ id: records.id, projectId: datasets.projectId })
      .from(records)
      .innerJoin(datasets, eq(records.datasetId, datasets.id))
      .where(and(eq(records.id, String(targetId)), eq(records.datasetId, f.reference!.sheetId)));
    if (!target || target.projectId !== projectId)
      throw new AppError(422, `Referência inválida em “${f.label}”.`);
    await tx.insert(links).values({ recordId, fieldId: f.id, targetId: target.id });
  }
}
export async function createRecord(
  userId: string,
  datasetId: string,
  id: string,
  input: Record<string, Value>,
) {
  const dataset = await datasetAccess(userId, datasetId, true);
  if (dataset.role !== 'records' && dataset.role !== 'lookup')
    throw new AppError(422, 'Este conjunto não aceita registros.');
  const values = validateValues(input, dataset.fields, {});
  for (const f of dataset.fields) if (!(f.id in values)) values[f.id] = null;
  checkKey(dataset, values);
  const references = dataset.fields.filter((f) => f.type === 'reference');
  for (const f of references)
    if (values[f.id] && !isUuid(values[f.id]))
      throw new AppError(422, `Referência inválida em “${f.label}”.`);
  return db.transaction(async (tx) => {
    // O id vem do cliente: reenviar o mesmo pedido devolve o registro já criado, sem duplicar.
    const [existing] = await tx.select().from(records).where(eq(records.id, id));
    if (existing) {
      if (existing.datasetId !== datasetId)
        throw new AppError(409, 'Identificador já usado.', 'CONFLICT');
      return existing;
    }
    const [saved] = await tx
      .insert(records)
      .values({
        id,
        datasetId,
        values,
        externalKey: dataset.keyField ? String(values[dataset.keyField]) : null,
        updatedBy: userId,
        source: {
          file: 'Criado no Preenche',
          sheet: '',
          row: 0,
          region: '',
          mappingVersion: dataset.schemaVersion,
          original: {},
        },
      })
      .returning();
    await syncLinks(tx, saved.id, dataset.projectId, references, values);
    await tx
      .insert(revisions)
      .values({ recordId: saved.id, authorId: userId, version: 1, before: null, after: values });
    return saved;
  });
}
export async function updateRecord(
  userId: string,
  id: string,
  version: number,
  patch: Record<string, Value>,
) {
  const { record, dataset } = await recordAccess(userId, id, true);
  const values = validateValues(patch, dataset.fields, record.values);
  checkKey(dataset, values);
  for (const f of dataset.fields.filter((f) => f.type === 'reference'))
    if (values[f.id] && !isUuid(values[f.id]))
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
    await syncLinks(
      tx,
      id,
      dataset.projectId,
      dataset.fields.filter((f) => f.type === 'reference' && Object.hasOwn(patch, f.id)),
      values,
    );
    await tx.insert(revisions).values({
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
