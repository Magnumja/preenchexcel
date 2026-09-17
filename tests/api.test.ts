import { afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/server/app';
import { pool, db } from '../src/server/db';
import { members } from '../src/server/schema';
const origin = process.env.APP_ORIGIN!;
afterAll(async () => {
  await pool.end();
});
it('isola espaços, publica sem duplicar e salva com histórico/concorrência', async () => {
  const a = request.agent(app),
    b = request.agent(app);
  const register = async (agent: typeof a) => {
    const r = await agent
      .post('/api/auth/sign-up/email')
      .set('Origin', origin)
      .send({
        name: 'Pessoa de teste',
        email: `${randomUUID()}@example.test`,
        password: randomUUID(),
      });
    expect(r.status, r.text).toBe(200);
    return r.body.user.id as string;
  };
  await register(a);
  const bid = await register(b);
  const ws = await a.post('/api/workspaces').set('Origin', origin).send({ name: 'Teste' });
  expect(ws.status, ws.text).toBe(201);
  const wid = ws.body.id;
  expect((await b.get(`/api/workspaces/${wid}/projects`)).status).toBe(404);
  expect(
    (await a.post('/api/workspaces').set('Origin', 'https://invalid.test').send({ name: 'X' }))
      .status,
  ).toBe(403);
  const upload = await a
    .post(`/api/workspaces/${wid}/imports`)
    .set('Origin', origin)
    .attach('files', Buffer.from('ID,Nome,Quantidade\n001,Café,2\n002,Chá,0'), 'estoque.csv');
  expect(upload.status, upload.text).toBe(201);
  const mappings = upload.body.diagnosis.mappings;
  mappings[0].keyField = 'c1';
  mappings[0].fields[2].type = 'number';
  const config = {
    name: 'Estoque',
    description: 'Teste',
    locale: 'pt-BR',
    acknowledged: true,
    mappings,
  };
  const path = `/api/imports/${upload.body.id}/confirm`;
  const [first, retry] = await Promise.all([
    a.post(path).set('Origin', origin).send(config),
    a.post(path).set('Origin', origin).send(config),
  ]);
  expect(first.status, first.text).toBe(200);
  expect(retry.body).toEqual(first.body);
  expect(
    (
      await a
        .post(path)
        .set('Origin', origin)
        .send({ ...config, name: 'Outro' })
    ).status,
  ).toBe(409);
  const project = await a.get(`/api/projects/${first.body.projectId}`);
  expect(project.body.datasets).toHaveLength(1);
  const ds = project.body.datasets[0].id;
  const list = await a.get(`/api/datasets/${ds}/records`);
  expect(list.body.total).toBe(2);
  const rec = list.body.items.find((r: { values: { c1: string } }) => r.values.c1 === '001');
  expect((await b.get(`/api/records/${rec.id}`)).status).toBe(404);
  await db.insert(members).values({ workspaceId: wid, userId: bid, role: 'viewer' });
  expect(
    (
      await b
        .patch(`/api/records/${rec.id}`)
        .set('Origin', origin)
        .send({ version: 1, values: { c2: 'X' } })
    ).status,
  ).toBe(403);
  const saved = await a
    .patch(`/api/records/${rec.id}`)
    .set('Origin', origin)
    .send({ version: 1, values: { c3: 5 } });
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body.values).toEqual({ c1: '001', c2: 'Café', c3: 5 });
  expect(
    (
      await a
        .patch(`/api/records/${rec.id}`)
        .set('Origin', origin)
        .send({ version: 1, values: { c3: 9 } })
    ).status,
  ).toBe(409);
  expect(
    (
      await a
        .patch(`/api/records/${rec.id}`)
        .set('Origin', origin)
        .send({ version: 2, values: { c1: '002' } })
    ).status,
  ).toBe(409);
  const history = await a.get(`/api/records/${rec.id}/history`);
  expect(history.body).toHaveLength(2);
  expect(history.body[0].before.c3).toBe(2);
  expect(history.body[0].after.c3).toBe(5);
  expect((await a.get(`/api/records/${rec.id}`)).body.record.version).toBe(2);
  const exported = await a.get(`/api/datasets/${ds}/export`);
  expect(exported.text).toContain('"001","Café","5"');
  await a.post('/api/auth/sign-out').set('Origin', origin).send({});
  expect((await a.get(`/api/records/${rec.id}`)).status).toBe(401);
});
