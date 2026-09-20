import express from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { workspaces, members, user } from '../schema';
import { workspaceAccess } from '../access';
import { AppError } from '../values';
import { uuid, nameSchema } from './shared';
export const router = express.Router();
router.get('/api/workspaces', async (_req, res) => {
  const list = await db
    .select({ id: workspaces.id, name: workspaces.name, role: members.role })
    .from(workspaces)
    .innerJoin(members, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, res.locals.user.id));
  res.json(list);
});
router.post('/api/workspaces', async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const w = await db.transaction(async (tx) => {
    const [w] = await tx.insert(workspaces).values({ name }).returning();
    await tx
      .insert(members)
      .values({ workspaceId: w.id, userId: res.locals.user.id, role: 'owner' });
    return { ...w, role: 'owner' };
  });
  res.status(201).json(w);
});
router.get('/api/workspaces/:wid/members', async (req, res) => {
  await workspaceAccess(res.locals.user.id, uuid(req.params.wid));
  res.json(
    await db
      .select({ id: user.id, name: user.name, email: user.email, role: members.role })
      .from(members)
      .innerJoin(user, eq(members.userId, user.id))
      .where(eq(members.workspaceId, uuid(req.params.wid))),
  );
});
router.post('/api/workspaces/:wid/members', async (req, res) => {
  const wid = uuid(req.params.wid),
    member = await workspaceAccess(res.locals.user.id, wid, true);
  if (member.role !== 'owner') throw new AppError(403, 'Somente o proprietário gerencia membros.');
  const body = z
    .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']) })
    .strict()
    .parse(req.body);
  const [u] = await db.select().from(user).where(eq(user.email, body.email.toLowerCase()));
  if (!u) throw new AppError(422, 'Esta pessoa precisa criar uma conta antes de ser adicionada.');
  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, wid), eq(members.userId, u.id)));
  if (existing?.role === 'owner')
    throw new AppError(422, 'O proprietário não pode ser alterado aqui.');
  await db
    .insert(members)
    .values({ workspaceId: wid, userId: u.id, role: body.role })
    .onConflictDoUpdate({
      target: [members.workspaceId, members.userId],
      set: { role: body.role },
    });
  res.json({ ok: true });
});
router.delete('/api/workspaces/:wid/members/:userId', async (req, res) => {
  const wid = uuid(req.params.wid),
    member = await workspaceAccess(res.locals.user.id, wid, true);
  if (member.role !== 'owner') throw new AppError(403, 'Somente o proprietário gerencia membros.');
  const target = z.string().min(1).max(100).parse(req.params.userId);
  const [existing] = await db
    .select()
    .from(members)
    .where(and(eq(members.workspaceId, wid), eq(members.userId, target)));
  if (!existing) throw new AppError(404, 'Membro não encontrado.', 'NOT_FOUND');
  if (existing.role === 'owner') throw new AppError(422, 'O proprietário não pode ser removido.');
  await db.delete(members).where(and(eq(members.workspaceId, wid), eq(members.userId, target)));
  res.status(204).end();
});
