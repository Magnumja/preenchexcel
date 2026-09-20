import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseFiles, proposeMapping, prepareImport, prepareSheet } from '../src/server/importer';
it('preserva CSV, expõe cabeçalhos duplicados e nunca junta abas', async () => {
  const d = await parseFiles([
    {
      originalname: 'clientes.csv',
      buffer: Buffer.from('Código;Nome;Nome\n001;Ana;Silva\n002;João;Souza'),
    },
  ]);
  expect(d.sheets[0].rows[1][0].value).toBe('001');
  expect(d.sheets[0].warnings.join(' ')).toContain('duplicado');
  expect(d.mappings[0].fields.map((f) => f.id)).toEqual(['c1', 'c2', 'c3']);
});
it('detecta título antes do cabeçalho e fórmulas somente leitura', async () => {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('Estoque');
  ws.addRow(['Inventário']);
  ws.addRow(['Código', 'Produto', 'Quantidade']);
  ws.addRow(['001', 'Café', { formula: '1+1', result: 2 }]);
  book.addWorksheet('Resumo').addRows([['Total'], [2]]);
  const d = await parseFiles([
    { originalname: 'estoque.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) },
  ]);
  expect(d.sheets).toHaveLength(2);
  expect(d.mappings[0].headerRow).toBe(2);
  expect(d.mappings[0].fields[2].readonly).toBe(true);
  expect(d.mappings[1].role).toBe('report');
});
it('ignora linhas/colunas apenas formatadas e não quebra com data inválida', async () => {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('Censo');
  ws.addRow(['Código', 'Nome', 'Nascimento']);
  ws.addRow(['001', 'Ana', new Date(NaN)]);
  // Formatação sem conteúdo até a linha 3000 e coluna 30 não pode contar para o limite de linhas.
  ws.getCell(3000, 30).style = { font: { bold: true } };
  const d = await parseFiles([
    { originalname: 'censo.xlsx', buffer: Buffer.from(await book.xlsx.writeBuffer()) },
  ]);
  expect(d.sheets[0].rows).toHaveLength(2);
  expect(d.sheets[0].rows[0]).toHaveLength(3);
  expect(d.sheets[0].rows[1][2].value).toBeNull();
  // Colunas de data do Excel chegam em ISO e são propostas como data.
  const dated = new ExcelJS.Workbook();
  dated.addWorksheet('Datas').addRows([
    ['Código', 'Quando'],
    ['001', new Date(Date.UTC(2026, 0, 15))],
    ['002', new Date(Date.UTC(2026, 1, 1))],
  ]);
  const d2 = await parseFiles([
    { originalname: 'datas.xlsx', buffer: Buffer.from(await dated.xlsx.writeBuffer()) },
  ]);
  expect(d2.mappings[0].fields[1].type).toBe('date');
  expect(d2.sheets[0].rows[1][1].value).toBe('2026-01-15');
});
it('bloqueia chave duplicada e relações sem correspondência', async () => {
  const d = await parseFiles([
    { originalname: 'a.csv', buffer: Buffer.from('ID,Nome\n001,A\n001,B') },
  ]);
  d.mappings[0].keyField = 'c1';
  expect(() =>
    prepareImport(d, {
      name: 'A',
      description: '',
      locale: 'pt-BR',
      acknowledged: true,
      mappings: d.mappings,
    }),
  ).toThrow(/coluna A “ID”: a chave “001” se repete/);
  const { issues } = prepareSheet(
    d.sheets[0],
    { ...d.mappings[0], fields: d.mappings[0].fields.map((f) => ({ ...f, label: '' })) },
    'pt-BR',
    true,
  );
  // Com coleta, todos os problemas da aba aparecem de uma vez, apontando a coluna.
  expect(issues.map((i) => i.fieldId)).toEqual(['c1', 'c2', 'c1']);
  expect(issues[0].message).toMatch(/dê um nome ao campo/);
});
it('permite corrigir região sem descartar dados fora dela silenciosamente', async () => {
  const d = await parseFiles([
    { originalname: 'a.csv', buffer: Buffer.from('Título\nID,Nome\n01,A') },
  ]);
  const m = proposeMapping(d.sheets[0], 2);
  expect(m.fields.map((f) => f.label)).toEqual(['ID', 'Nome']);
  expect(m.headerRow).toBe(2);
});
