import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { members, datasets, projects, records } from './schema';
import { AppError } from './values';
export async function workspaceAccess(userId: string, workspaceId: string, write = false) {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.workspaceId, workspaceId)));
  if (!member) throw new AppError(404, 'Espaço não encontrado.', 'NOT_FOUND');
  if (write && member.role === 'viewer')
    throw new AppError(403, 'Seu perfil permite apenas consulta.', 'FORBIDDEN');
  return member;
}
export async function datasetAccess(userId: string, id: string, write = false) {
  const [result] = await db
    .select({ dataset: datasets, workspaceId: projects.workspaceId })
    .from(datasets)
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(datasets.id, id));
  if (!result) throw new AppError(404, 'Conjunto não encontrado.', 'NOT_FOUND');
  await workspaceAccess(userId, result.workspaceId, write);
  return result.dataset;
}
export async function recordAccess(userId: string, id: string, write = false) {
  const [record] = await db.select().from(records).where(eq(records.id, id));
  if (!record) throw new AppError(404, 'Registro não encontrado.', 'NOT_FOUND');
  const dataset = await datasetAccess(userId, record.datasetId, write);
  return { record, dataset };
}
