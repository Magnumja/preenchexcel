import { it, expect, afterAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { app } from '../src/server/app';
import { pool, db } from '../src/server/db';
import { datasets } from '../src/server/schema';
import { runSync, syncMappingFor } from '../src/server/sync';
const origin = process.env.APP_ORIGIN!;
afterAll(async () => {
  await pool.end();
});
const xlsxOf = async (rows: unknown[][]) => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('clientes').addRows(rows);
  return Buffer.from(await book.xlsx.writeBuffer());
};
const fetcher = (buffer: Buffer) => async () =>
  new Response(new Uint8Array(buffer), {
    headers: { 'content-type': 'application/octet-stream' },
  });
it('sincroniza com o link: aplica novidades, preserva edições locais e para se o cabeçalho mudar', async () => {
  const a = request.agent(app);
  const signup = await a
    .post('/api/auth/sign-up/email')
    .set('Origin', origin)
    .send({ name: 'Sync', email: `${randomUUID()}@example.test`, password: randomUUID() });
  const userId = signup.body.user.id as string;
  const w = await a.post('/api/workspaces').set('Origin', origin).send({ name: 'S' });
  const up = await a
    .post(`/api/workspaces/${w.body.id}/imports`)
    .set('Origin', origin)
    .attach(
      'files',
      Buffer.from('Código,Nome,Cidade\n001,Ana,Bonito\n002,Bruno,Dourados'),
      'clientes.csv',
    );
  const mapping = up.body.diagnosis.mappings[0];
  mapping.keyField = 'c1';
  const published = await a
    .post(`/api/imports/${up.body.id}/confirm`)
    .set('Origin', origin)
    .send({
      name: 'Clientes',
      description: '',
      locale: 'pt-BR',
      acknowledged: true,
      mappings: [mapping],
    });
  const project = await a.get(`/api/projects/${published.body.projectId}`);
  const ds = project.body.datasets[0].id as string;
  // Simula um conjunto vindo de um link (o publish faz isto quando o lote tem sourceUrl).
  await db
    .update(datasets)
    .set({
      sourceUrl: 'https://docs.google.com/spreadsheets/d/1234567890abcdefghijklmnopqrst/edit',
      syncMapping: syncMappingFor({ ...mapping, name: 'Renomeado' }, ds, 'clientes'),
      syncState: { userId },
    })
    .where(eq(datasets.id, ds));
  const list = async () =>
    (await a.get(`/api/datasets/${ds}/records?sort=c1`)).body.items as {
      id: string;
      values: Record<string, unknown>;
    }[];
  const bruno = (await list()).find((r) => r.values.c1 === '002')!;
  await a
    .patch(`/api/records/${bruno.id}`)
    .set('Origin', origin)
    .send({ version: 1, values: { c3: 'Campo Grande' } });
  const state = await runSync(
    ds,
    fetcher(
      await xlsxOf([
        ['Código', 'Nome', 'Cidade'],
        ['001', 'Ana', 'Corumbá'],
        ['002', 'Bruno', 'Dourados'],
        ['003', 'Carla', 'Bonito'],
      ]),
    ),
  );
  expect(state.status, state.message).toBe('ok');
  expect(state.plan).toMatchObject({ inserts: 1, updates: 1, conflicts: ['002'], missing: [] });
  expect((await list()).map((r) => [r.values.c1, r.values.c3])).toEqual([
    ['001', 'Corumbá'],
    ['002', 'Campo Grande'],
    ['003', 'Bonito'],
  ]);
  // Cabeçalho diferente: nada é aplicado e o erro fica registrado no estado.
  const changed = await runSync(
    ds,
    fetcher(
      await xlsxOf([
        ['ID', 'Nome', 'Cidade'],
        ['001', 'Ana', 'Outra'],
      ]),
    ),
  );
  expect(changed.status).toBe('error');
  expect(changed.message).toMatch(/cabeçalho da planilha mudou/);
  expect((await list())[0].values.c3).toBe('Corumbá');
  // Ligar a sincronização exige link salvo; a rota grava o estado.
  const toggled = await a
    .patch(`/api/datasets/${ds}/sync`)
    .set('Origin', origin)
    .send({ enabled: true });
  expect(toggled.status, toggled.text).toBe(200);
  expect(toggled.body.syncEnabled).toBe(true);
  expect((await a.get(`/api/datasets/${ds}`)).body.syncState.status).toBe('error');
});
