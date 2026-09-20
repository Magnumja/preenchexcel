import { it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/server/app';
import { pool } from '../src/server/db';
const origin = process.env.APP_ORIGIN!;
afterAll(async () => {
  await pool.end();
});
it('reimporta sobre um conjunto existente: inclui, atualiza, preserva edições e não apaga', async () => {
  const a = request.agent(app);
  await a
    .post('/api/auth/sign-up/email')
    .set('Origin', origin)
    .send({ name: 'Reconcilia', email: `${randomUUID()}@example.test`, password: randomUUID() });
  const w = await a.post('/api/workspaces').set('Origin', origin).send({ name: 'R' });
  const wid = w.body.id;
  const upload = async (csv: string) => {
    const r = await a
      .post(`/api/workspaces/${wid}/imports`)
      .set('Origin', origin)
      .attach('files', Buffer.from(csv), 'clientes.csv');
    expect(r.status, r.text).toBe(201);
    return r.body as { id: string; diagnosis: { mappings: Record<string, unknown>[] } };
  };
  // Primeira importação cria o conjunto com chave "Código".
  const first = await upload('Código,Nome,Cidade\n001,Ana,Bonito\n002,Bruno,Dourados');
  const m1 = first.diagnosis.mappings[0] as { keyField: string | null };
  m1.keyField = 'c1';
  const published = await a
    .post(`/api/imports/${first.id}/confirm`)
    .set('Origin', origin)
    .send({
      name: 'Clientes',
      description: '',
      locale: 'pt-BR',
      acknowledged: true,
      mappings: [m1],
    });
  expect(published.status, published.text).toBe(200);
  const projectId = published.body.projectId;
  const project = await a.get(`/api/projects/${projectId}`);
  const ds = project.body.datasets[0].id as string;
  const list = async () =>
    (await a.get(`/api/datasets/${ds}/records?sort=c1`)).body.items as {
      id: string;
      version: number;
      values: Record<string, unknown>;
    }[];
  // Bruno é editado no Preenche antes da reimportação.
  const bruno = (await list()).find((r) => r.values.c1 === '002')!;
  await a
    .patch(`/api/records/${bruno.id}`)
    .set('Origin', origin)
    .send({ version: 1, values: { c3: 'Campo Grande' } });
  // Arquivo novo com colunas em outra ordem: Ana muda de cidade, Bruno diverge da edição
  // feita no Preenche (conflito) e Carla é nova.
  const second = await upload(
    'Nome,Cidade,Código\nAna,Corumbá,001\nBruno,Dourados,002\nCarla,Bonito,003',
  );
  const m2 = second.diagnosis.mappings[0] as {
    datasetId?: string;
    conflicts?: string;
    fields: { id: string; target?: string }[];
  };
  m2.datasetId = ds;
  m2.fields[0].target = 'c2';
  m2.fields[1].target = 'c3';
  m2.fields[2].target = 'c1';
  const config = {
    name: 'Atualização',
    description: '',
    locale: 'pt-BR',
    acknowledged: true,
    projectId,
    mappings: [m2],
  };
  const preview = await a
    .post(`/api/imports/${second.id}/preview`)
    .set('Origin', origin)
    .send(config);
  expect(preview.status, preview.text).toBe(200);
  expect(preview.body[0].existing).toBe(true);
  expect(preview.body[0].plan).toMatchObject({
    inserts: 1,
    updates: 1,
    unchanged: 0,
    conflicts: ['002'],
    missing: [],
  });
  // Política padrão: mantém a edição de Bruno.
  const confirm = await a
    .post(`/api/imports/${second.id}/confirm`)
    .set('Origin', origin)
    .send(config);
  expect(confirm.status, confirm.text).toBe(200);
  expect(confirm.body.projectId).toBe(projectId);
  let items = await list();
  expect(items.map((r) => [r.values.c1, r.values.c2, r.values.c3, r.version])).toEqual([
    ['001', 'Ana', 'Corumbá', 2],
    ['002', 'Bruno', 'Campo Grande', 2],
    ['003', 'Carla', 'Bonito', 1],
  ]);
  expect((await a.get(`/api/projects/${projectId}`)).body.datasets).toHaveLength(1);
  // Terceira: arquivo manda nos conflitos; 003 ausente no arquivo continua existindo.
  const third = await upload('Código,Nome,Cidade\n001,Ana,Corumbá\n002,Bruno,Dourados');
  const m3 = third.diagnosis.mappings[0] as typeof m2;
  m3.datasetId = ds;
  m3.conflicts = 'file';
  m3.fields[0].target = 'c1';
  m3.fields[1].target = 'c2';
  m3.fields[2].target = 'c3';
  const cfg3 = { ...config, mappings: [m3] };
  const preview3 = await a
    .post(`/api/imports/${third.id}/preview`)
    .set('Origin', origin)
    .send(cfg3);
  expect(preview3.body[0].plan).toMatchObject({
    unchanged: 1,
    conflicts: ['002'],
    missing: ['003'],
  });
  expect(
    (await a.post(`/api/imports/${third.id}/confirm`).set('Origin', origin).send(cfg3)).status,
  ).toBe(200);
  items = await list();
  expect(items.map((r) => [r.values.c1, r.values.c3, r.version])).toEqual([
    ['001', 'Corumbá', 2],
    ['002', 'Dourados', 3],
    ['003', 'Bonito', 1],
  ]);
  const history = await a.get(`/api/records/${bruno.id}/history`);
  expect(history.body.map((h: { version: number }) => h.version)).toEqual([3, 2, 1]);
  // Conjunto de outro projeto é recusado.
  const other = await upload('Código,Nome\n001,X');
  const m4 = other.diagnosis.mappings[0] as typeof m2;
  m4.datasetId = ds;
  m4.fields[0].target = 'c1';
  const bad = await a
    .post(`/api/imports/${other.id}/preview`)
    .set('Origin', origin)
    .send({ ...config, projectId: undefined, mappings: [m4] });
  expect(bad.status).toBe(422);
});
