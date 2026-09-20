import { it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/server/app';
import { pool } from '../src/server/db';
const origin = process.env.APP_ORIGIN!;
afterAll(async () => {
  await pool.end();
});
it('importa XLSX, resolve vínculos e exclui resumo sem duplicar dados', async () => {
  const a = request.agent(app);
  await a
    .post('/api/auth/sign-up/email')
    .set('Origin', origin)
    .send({
      name: 'Teste relações',
      email: `${randomUUID()}@example.test`,
      password: randomUUID(),
    });
  const w = await a.post('/api/workspaces').set('Origin', origin).send({ name: 'Relações' });
  const batch = await a
    .post(`/api/workspaces/${w.body.id}/imports`)
    .set('Origin', origin)
    .attach('files', 'public/examples/estoque.xlsx');
  expect(batch.status, batch.text).toBe(201);
  const mappings = batch.body.diagnosis.mappings;
  mappings[0].role = 'lookup';
  mappings[0].keyField = 'c1';
  mappings[1].keyField = 'c1';
  mappings[1].fields[2].type = 'reference';
  mappings[1].fields[2].reference = { sheetId: mappings[0].sheetId, fieldId: 'c1' };
  const config = {
    name: 'Estoque',
    description: '',
    locale: 'pt-BR',
    acknowledged: true,
    mappings,
  };
  const preview = await a
    .post(`/api/imports/${batch.body.id}/preview`)
    .set('Origin', origin)
    .send(config);
  expect(preview.status, preview.text).toBe(200);
  expect(preview.body.map((p: { count: number }) => p.count)).toEqual([3, 4]);
  const published = await a
    .post(`/api/imports/${batch.body.id}/confirm`)
    .set('Origin', origin)
    .send(config);
  expect(published.status, published.text).toBe(200);
  const p = await a.get(`/api/projects/${published.body.projectId}`);
  expect(p.body.datasets).toHaveLength(2);
  const products = p.body.datasets.find((d: { name: string }) => d.name === 'Produtos');
  const list = await a.get(`/api/datasets/${products.id}/records`);
  expect(list.body.total).toBe(4);
  const coffee = list.body.items.find((r: { values: { c1: string } }) => r.values.c1 === '001');
  expect(coffee.values.c3).toMatch(/^[0-9a-f-]{36}$/);
  const category = await a.get(`/api/records/${coffee.values.c3}`);
  expect(category.body.record.values.c1).toBe('AL');
  const related = await a.get(`/api/records/${coffee.values.c3}/related`);
  expect(related.body).toHaveLength(2);
  const exported = await a.get(`/api/datasets/${products.id}/export`);
  expect(exported.text).toContain('"001","Café 500g","AL","28"');
  expect(
    (
      await a
        .patch(`/api/records/${coffee.id}`)
        .set('Origin', origin)
        .send({ version: 1, values: { c3: coffee.id } })
    ).status,
  ).toBe(422);
  expect((await a.get(`/api/records/${coffee.id}`)).body.record.version).toBe(1);
});
