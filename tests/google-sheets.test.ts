import { it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseSheetsUrl, fetchSheetAsXlsx } from '../src/server/google-sheets';
const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';
it('aceita apenas links de docs.google.com e monta a URL a partir do id', () => {
  expect(parseSheetsUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`).id).toBe(id);
  expect(() => parseSheetsUrl('https://example.com/spreadsheets/d/' + id)).toThrow(/docs.google/);
  expect(() => parseSheetsUrl('não é link')).toThrow(/link completo/);
});
it('baixa o XLSX exportado e reconhece planilha privada ou resposta inválida', async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Clientes').addRows([
    ['Código', 'Nome'],
    ['001', 'Ana'],
  ]);
  const xlsx = Buffer.from(await book.xlsx.writeBuffer());
  const calls: string[] = [];
  const ok = async (url: string) => {
    calls.push(url);
    return new Response(new Uint8Array(xlsx), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': "attachment; filename*=UTF-8''Meus%20clientes.xlsx",
      },
    });
  };
  const result = await fetchSheetAsXlsx(`https://docs.google.com/spreadsheets/d/${id}/edit`, ok);
  expect(result.name).toBe('Meus clientes.xlsx');
  expect(result.buffer.length).toBe(xlsx.length);
  expect(calls).toEqual([`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`]);
  const login = async () =>
    new Response('<html>Fazer login</html>', { headers: { 'content-type': 'text/html' } });
  await expect(
    fetchSheetAsXlsx(`https://docs.google.com/spreadsheets/d/${id}`, login),
  ).rejects.toThrow(/não está pública/);
  const garbage = async () =>
    new Response('nope', { headers: { 'content-type': 'application/octet-stream' } });
  await expect(
    fetchSheetAsXlsx(`https://docs.google.com/spreadsheets/d/${id}`, garbage),
  ).rejects.toThrow(/não devolveu uma planilha/);
});
