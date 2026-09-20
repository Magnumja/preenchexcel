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
  const projectList = await a.get(`/api/workspaces/${wid}/projects`);
  expect(projectList.status, projectList.text).toBe(200);
  expect(projectList.body).toMatchObject([{ name: 'Estoque', datasetCount: 1, recordCount: 2 }]);
  const project = await a.get(`/api/projects/${first.body.projectId}`);
  expect(project.body.datasets).toHaveLength(1);
  expect(project.body.datasets[0].recordCount).toBe(2);
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
  // Criação idempotente: o mesmo id enviado duas vezes resulta em um único registro.
  const newId = randomUUID();
  const createBody = { id: newId, values: { c1: '003', c2: 'Mate', c3: 1 } };
  const created = await a
    .post(`/api/datasets/${ds}/records`)
    .set('Origin', origin)
    .send(createBody);
  expect(created.status, created.text).toBe(201);
  const again = await a.post(`/api/datasets/${ds}/records`).set('Origin', origin).send(createBody);
  expect(again.status).toBe(201);
  expect(again.body.id).toBe(newId);
  expect((await a.get(`/api/datasets/${ds}/records`)).body.total).toBe(3);
  expect(
    (
      await a
        .post(`/api/datasets/${ds}/records`)
        .set('Origin', origin)
        .send({ id: randomUUID(), values: { c1: '003', c2: 'Duplicado' } })
    ).status,
  ).toBe(409);
  expect(
    (await b.post(`/api/datasets/${ds}/records`).set('Origin', origin).send(createBody)).status,
  ).toBe(403);
  const contains = await a.get(
    `/api/datasets/${ds}/records?filterField=c2&filterValue=ma&filterMode=contains`,
  );
  expect(contains.body.items.map((r: { values: { c2: string } }) => r.values.c2)).toEqual(['Mate']);
  // Configurações: rótulos/grupos e nome do projeto mudam; tipo não.
  const renamed = await a
    .patch(`/api/datasets/${ds}`)
    .set('Origin', origin)
    .send({ fields: [{ id: 'c3', label: 'Qtd.', group: 'Estoque' }] });
  expect(renamed.status, renamed.text).toBe(200);
  expect(renamed.body.fields[2]).toMatchObject({ label: 'Qtd.', group: 'Estoque', type: 'number' });
  expect(
    (
      await a
        .patch(`/api/projects/${first.body.projectId}`)
        .set('Origin', origin)
        .send({ name: 'Estoque 2', description: 'x' })
    ).body.name,
  ).toBe('Estoque 2');
  const batches = await a.get(`/api/projects/${first.body.projectId}/imports`);
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0].sheets[0]).toMatchObject({ name: 'estoque', role: 'records', fields: 3 });
  // Link do Google Sheets: só docs.google.com; leitor não importa.
  const badLink = await a
    .post(`/api/workspaces/${wid}/imports/link`)
    .set('Origin', origin)
    .send({ url: 'https://example.com/spreadsheets/d/1234567890abcdefghijklmnop' });
  expect(badLink.status).toBe(422);
  expect(
    (
      await b
        .post(`/api/workspaces/${wid}/imports/link`)
        .set('Origin', origin)
        .send({ url: 'https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnop/edit' })
    ).status,
  ).toBe(403);
  const exported = await a.get(`/api/datasets/${ds}/export`);
  expect(exported.text).toContain('"001","Café","5"');
  await a.post('/api/auth/sign-out').set('Origin', origin).send({});
  expect((await a.get(`/api/records/${rec.id}`)).status).toBe(401);
});
