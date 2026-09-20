import { z } from 'zod';
import { and, lt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { imports } from '../schema';
export const uuid = (v: unknown) => z.string().uuid().parse(v);
export const nameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
/** O que o cliente vê de um conjunto: o mapeamento interno da sincronização fica de fora. */
export const publicDataset = <T extends { syncMapping?: unknown }>({ syncMapping, ...d }: T) => ({
  ...d,
  sourceSheet: (syncMapping as { name?: string } | null | undefined)?.name ?? null,
});
/** Rascunhos não publicados expiram em 24h; a limpeza acontece a cada nova importação. */
export const expireDrafts = () =>
  db
    .delete(imports)
    .where(
      and(
        isNull(imports.publishedProjectId),
        lt(imports.createdAt, new Date(Date.now() - 86400000)),
      ),
    );
