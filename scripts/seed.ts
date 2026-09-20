import { eq } from 'drizzle-orm';
import { auth } from '../src/server/auth';
import { db, pool } from '../src/server/db';
import { user, workspaces, members } from '../src/server/schema';
// Conta de demonstração para desenvolvimento local. Não usar em produção.
const email = 'demo@example.test',
  password = 'demo123456';
if (process.env.NODE_ENV === 'production') throw new Error('Seed indisponível em produção.');
const [existing] = await db.select().from(user).where(eq(user.email, email));
if (existing) {
  console.log(`Conta já existe: ${email} / ${password}`);
} else {
  const { user: created } = await auth.api.signUpEmail({
    body: { name: 'Demonstração', email, password },
  });
  await db.transaction(async (tx) => {
    const [w] = await tx.insert(workspaces).values({ name: 'Demonstração' }).returning();
    await tx.insert(members).values({ workspaceId: w.id, userId: created.id, role: 'owner' });
  });
  console.log(`Conta criada: ${email} / ${password}`);
}
await pool.end();
