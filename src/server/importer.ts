import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import yauzl from 'yauzl';
import type {
  Cell,
  Sheet,
  Mapping,
  Diagnosis,
  Confirmation,
  Value,
  Field,
} from '../shared/contracts';
import { AppError, convertValue, validateValues } from './values';
const occupied = (c: Cell | undefined) =>
  c?.value !== null && c?.value !== undefined && c?.value !== '';
async function checkZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new AppError(422, 'Arquivo Excel inválido.'));
      let size = 0,
        count = 0;
      zip.on('error', () => reject(new AppError(422, 'Arquivo Excel inválido.')));
      zip.on('entry', (e: yauzl.Entry) => {
        size += e.uncompressedSize;
        count++;
        if (size > 40 * 1024 * 1024 || count > 2000) {
          zip.close();
          reject(new AppError(413, 'Excel excede o limite de descompactação (40 MB).'));
        } else zip.readEntry();
      });
      zip.on('end', resolve);
      zip.readEntry();
    }),
  );
}
export function proposeMapping(sheet: Sheet, headerRow?: number): Mapping {
  const candidates = sheet.rows
    .slice(0, 30)
    .map((row, i) => ({ i, count: row.filter(occupied).length }));
  const best = candidates.reduce((a, b) => (b.count > a.count ? b : a), { i: 0, count: 0 });
  const h = headerRow ?? best.i + 1;
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const fields: Field[] = Array.from({ length: width }, (_, i) => {
    const source = String(sheet.rows[h - 1]?.[i]?.value ?? '');
    const column = sheet.rows.slice(h).map((r) => r[i]);
    const values = column.filter(occupied);
    const readonly = column.some((c) => c?.formula !== undefined);
    // Identifiers remain textual. Only native Excel scalar types are inferred.
    const identifier = /(^id$|cód|cod|cpf|cnpj|cep|telefone|matrícula)/i.test(source);
    const type = identifier
      ? 'text'
      : values.length && values.every((c) => typeof c?.value === 'number')
        ? 'number'
        : values.length && values.every((c) => typeof c?.value === 'boolean')
          ? 'boolean'
          : 'text';
    return {
      id: `c${i + 1}`,
      source,
      label: source.slice(0, 100) || `Coluna ${i + 1}`,
      type,
      required: false,
      readonly,
      options: [],
      currency: 'BRL',
      group: 'Informações gerais',
    };
  });
  return {
    sheetId: sheet.id,
    name: sheet.name.slice(0, 100),
    // Abas vazias saem da importação; ocultas e resumos viram relatório até a pessoa decidir.
    role: !sheet.rows.some((r) => r.some(occupied))
      ? 'exclude'
      : sheet.warnings.some((w) => w.includes('oculta')) ||
          /resumo|total|todos|painel|relatório|impress/i.test(sheet.name)
        ? 'report'
        : 'records',
    headerRow: h,
    endRow: sheet.rows.length,
    startColumn: 1,
    endColumn: width,
    keyField: null,
    conflicts: 'keep',
    titleField:
      [
        /^nome/i,
        /nome|paciente|cliente|pessoa|razão/i,
        /produto|item|título|projeto/i,
        /descrição/i,
      ]
        .map((re) => fields.find((f) => re.test(f.label))?.id)
        .find(Boolean) ?? 'c1',
    fields,
  };
}
// Datas fora da faixa válida (serial inválido no arquivo) ficam vazias, nunca uma exceção.
const isoDate = (d: Date): Value =>
  Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
function scalar(cell: ExcelJS.Cell): Cell {
  const v = cell.value;
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
    const result = 'result' in v ? v.result : undefined;
    return {
      value:
        result instanceof Date
          ? isoDate(result)
          : typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string'
            ? result
            : null,
      formula: cell.formula || '[fórmula compartilhada]',
    };
  }
  if (v instanceof Date) return { value: isoDate(v) };
  if (typeof v === 'object') {
    // Texto rico, hipervínculo ou erro (#N/A): usar o texto exibido; erros ficam vazios.
    if ('error' in v) return { value: null };
    try {
      return { value: cell.text };
    } catch {
      return { value: null };
    }
  }
  if (typeof v === 'number' && /^0{2,}$/.test(cell.numFmt))
    return { value: String(v).padStart(cell.numFmt.length, '0') };
  return { value: v };
}
export async function parseFiles(
  files: { originalname: string; buffer: Buffer }[],
): Promise<Diagnosis> {
  const sheets: Sheet[] = [];
  for (const file of files) {
    if (file.buffer.length > 5 * 1024 * 1024)
      throw new AppError(413, 'Limite de 5 MB por arquivo.');
    const name = file.originalname.replaceAll('\\', '/').split('/').pop()!.slice(0, 200);
    if (/\.csv$/i.test(name)) {
      let rows: string[][];
      try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
        const first = content.split(/\r?\n/).slice(0, 10).join('\n');
        const delimiter =
          (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
        rows = parse(content, {
          bom: true,
          delimiter,
          relax_column_count: true,
          skip_empty_lines: false,
          max_record_size: 100000,
        });
      } catch {
        throw new AppError(
          422,
          `Não foi possível ler ${name}. Use CSV UTF-8, separado por vírgula ou ponto e vírgula.`,
        );
      }
      sheets.push({
        id: `s${sheets.length}`,
        file: name,
        name: name.replace(/\.csv$/i, ''),
        rows: rows.map((r) => r.map((value) => ({ value }))),
        warnings: [],
      });
    } else if (/\.xlsx$/i.test(name)) {
      await checkZip(file.buffer);
      const book = new ExcelJS.Workbook();
      try {
        await book.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
      } catch {
        throw new AppError(422, `Não foi possível ler ${name}. Arquivo inválido ou protegido.`);
      }
      for (const ws of book.worksheets) {
        if (ws.rowCount > 10001 || ws.columnCount > 100)
          throw new AppError(413, 'Limite de 10 mil linhas e 100 colunas por lote.');
        // getCell materializa células vazias e fica lento em abas formatadas; percorrer só as existentes.
        let rows: Cell[][] = Array.from({ length: ws.rowCount }, () =>
          Array.from({ length: ws.columnCount }, () => ({ value: null })),
        );
        ws.eachRow({ includeEmpty: false }, (row, r) =>
          row.eachCell({ includeEmpty: false }, (cell, c) => {
            rows[r - 1][c - 1] = scalar(cell);
          }),
        );
        // Linhas e colunas apenas formatadas (sem conteúdo) não contam para os limites nem para a região.
        const used = (c: Cell) => occupied(c) || c.formula !== undefined;
        while (rows.length && !rows[rows.length - 1].some(used)) rows.pop();
        const width = Math.max(0, ...rows.map((r) => r.findLastIndex(used) + 1));
        rows = rows.map((r) => r.slice(0, width));
        const warnings: string[] = [];
        if (ws.model.merges?.length)
          warnings.push('Há células mescladas. Revise a região e os valores antes de importar.');
        if (ws.state !== 'visible') warnings.push('Esta aba está oculta no arquivo.');
        sheets.push({ id: `s${sheets.length}`, file: name, name: ws.name, rows, warnings });
      }
    } else throw new AppError(422, 'Use arquivos .xlsx ou .csv. XLS e XLSM não são suportados.');
  }
  if (!sheets.length || sheets.length > 20 || sheets.reduce((n, s) => n + s.rows.length, 0) > 10020)
    throw new AppError(413, 'Use até 20 abas e 10 mil linhas por lote.');
  for (const s of sheets) {
    if (!s.rows.length) s.rows = [[{ value: null }]];
    if (
      s.rows.some(
        (r) =>
          r.length > 100 || r.some((c) => typeof c.value === 'string' && c.value.length > 10000),
      )
    )
      throw new AppError(413, 'Limite de 100 colunas e 10 mil caracteres por célula.');
    const m = proposeMapping(s),
      names = m.fields.map((f) => f.source);
    if (names.some((x) => !x)) s.warnings.push('Há colunas sem nome. Defina seus rótulos.');
    if (new Set(names).size !== names.length)
      s.warnings.push('Cabeçalho duplicado: cada coluna será preservada separadamente.');
    if (m.headerRow > 1)
      s.warnings.push(
        `${m.headerRow - 1} linha(s) antes do cabeçalho sugerido. Revise sua exclusão.`,
      );
    if (s.rows.some((r) => r.some((c) => c.formula !== undefined)))
      s.warnings.push(
        'Fórmulas: apenas resultado salvo no arquivo; fotografia sem recálculo e somente leitura.',
      );
    if (
      s.rows.some((r) =>
        r.some((c) => typeof c.value === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c.value)),
      )
    )
      s.warnings.push('Datas textuais: escolha o tipo e confira a localidade antes de converter.');
  }
  return {
    sheets,
    mappings: sheets.map((s) => proposeMapping(s)),
    warnings: [
      'Nenhuma aba será unida automaticamente. Resumos podem duplicar registros: escolha a fonte correta.',
      'Gráficos, tabelas dinâmicas, estilos e automações não são convertidos. Revise as regiões excluídas.',
    ],
  };
}
export interface Prepared {
  mapping: Mapping;
  sheet: Sheet;
  existing?: ExistingDataset;
  rows: { row: number; values: Record<string, Value>; original: Record<string, Value> }[];
}
export interface Issue {
  sheetId: string;
  fieldId: string | null;
  message: string;
}
const columnLetter = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
// Mensagens apontam a coluna do arquivo (a decisão fica no campo), com a linha apenas como exemplo.
const column = (f: Field) => `coluna ${columnLetter(Number(f.id.slice(1)))} “${f.label}”`;
class SheetIssues extends Error {
  constructor(public issue: Issue) {
    super(issue.message);
  }
}
/**
 * Converte uma aba segundo o mapeamento. Com `collect`, reúne todos os problemas por coluna em vez
 * de parar no primeiro; sem `collect`, lança o primeiro como AppError com sheetId/fieldId.
 */
/** Conjunto já publicado que uma aba pode atualizar (campos vêm do esquema, não do mapeamento). */
export interface ExistingDataset {
  id: string;
  projectId: string;
  name: string;
  fields: Field[];
  keyField: string | null;
}
export function prepareSheet(
  s: Sheet,
  m: Mapping,
  locale: Confirmation['locale'],
  collect = false,
  existing?: ExistingDataset,
): { rows: Prepared['rows']; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const report = (fieldId: string | null, message: string) => {
    const key = `${fieldId}:${message.replace(/linha \d+/, '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const issue = { sheetId: m.sheetId, fieldId, message };
    if (!collect) throw new SheetIssues(issue);
    issues.push(issue);
  };
  try {
    if (!s.rows.some((r) => r.some(occupied)))
      report(null, 'A aba está vazia. Marque-a como “Não importar esta aba” na etapa Estrutura.');
    else if (m.headerRow >= m.endRow || m.endRow > s.rows.length || m.startColumn > m.endColumn)
      report(null, `Região inválida em ${m.name}: confira cabeçalho, última linha e colunas.`);
    const expected = Array.from(
      { length: m.endColumn - m.startColumn + 1 },
      (_, i) => `c${i + m.startColumn}`,
    );
    if (
      m.fields.length !== expected.length ||
      expected.some((id) => !m.fields.some((f) => f.id === id))
    )
      report(null, 'Campos não correspondem à região selecionada.');
    // Colunas lidas do arquivo → campo que recebe o valor. Ao atualizar um conjunto existente, o
    // campo é o do esquema publicado e a coluna só indica de onde ler.
    let columns: { column: Field; field: Field }[];
    let key: Field | undefined;
    if (existing) {
      if (!existing.keyField)
        report(
          null,
          `${existing.name} não tem chave externa; não é possível reconhecer registros.`,
        );
      const targets = new Set<string>();
      columns = [];
      for (const f of m.fields) {
        if (!f.target) continue;
        const field = existing.fields.find((x) => x.id === f.target);
        if (!field) report(f.id, `${column(f)}: campo de destino desconhecido.`);
        else if (targets.has(field.id))
          report(f.id, `${column(f)}: “${field.label}” já recebe outra coluna.`);
        else {
          targets.add(field.id);
          columns.push({ column: f, field });
        }
      }
      if (!columns.length) report(null, 'Associe ao menos uma coluna a um campo do conjunto.');
      for (const f of existing.fields) {
        if (f.id === existing.keyField && !targets.has(f.id))
          report(null, `Associe uma coluna à chave “${f.label}” para reconhecer os registros.`);
        else if (f.required && !targets.has(f.id))
          report(null, `“${f.label}” é obrigatório no conjunto: associe uma coluna a ele.`);
      }
      key = columns.find((c) => c.field.id === existing.keyField)?.column;
    } else {
      if (!m.fields.some((f) => f.id === m.titleField))
        report(null, 'Escolha o campo usado no título da ficha.');
      key = m.keyField ? m.fields.find((f) => f.id === m.keyField) : undefined;
      if (m.keyField && !key) report(null, 'A chave externa precisa ser um campo da região.');
      if (key && key.type !== 'text')
        report(key.id, `${column(key)}: identificadores devem ser do tipo texto.`);
      for (const f of m.fields) {
        if (!f.label.trim()) report(f.id, `${column(f)}: dê um nome ao campo.`);
        if ((f.type === 'select' || f.type === 'multiselect') && !f.options.some((o) => o.trim()))
          report(f.id, `${column(f)}: informe as opções da seleção.`);
        if (f.type === 'reference' && !f.reference)
          report(f.id, `${column(f)}: escolha o conjunto e a chave de destino.`);
      }
      columns = m.fields.map((f) => ({ column: f, field: f }));
    }
    const schema = existing ? existing.fields : m.fields;
    const keys = new Set<string>();
    const rows: Prepared['rows'] = [];
    for (let r = m.headerRow; r < m.endRow; r++) {
      const original: Record<string, Value> = {},
        values: Record<string, Value> = {};
      if (!s.rows[r]?.slice(m.startColumn - 1, m.endColumn).some(occupied)) continue;
      for (const { column: f, field } of columns) {
        const c = s.rows[r]?.[Number(f.id.slice(1)) - 1];
        if (c?.formula !== undefined && !field.readonly)
          report(f.id, `${column(f)}: há fórmulas nesta coluna; marque como só leitura.`);
        original[f.id] = c?.value ?? null;
        try {
          values[field.id] = convertValue(original[f.id], field, locale);
        } catch (e) {
          values[field.id] = null;
          report(
            f.id,
            `${column(f)}: ${(e as Error).message} Exemplo na linha ${r + 1}: “${String(original[f.id]).slice(0, 40)}”.`,
          );
        }
      }
      try {
        validateValues(values, schema, {}, true);
      } catch (e) {
        const field = schema.find((f) => (e as Error).message.includes(`“${f.label}”`));
        const f = columns.find((c) => c.field.id === field?.id)?.column;
        report(
          f?.id ?? null,
          f
            ? `${column(f)}: ${(e as Error).message} Exemplo na linha ${r + 1}.`
            : (e as Error).message,
        );
      }
      if (key) {
        const k = String(values[existing ? existing.keyField! : key.id] ?? '');
        if (!k)
          report(
            key.id,
            `${column(key)}: a chave está vazia em alguma linha (ex.: linha ${r + 1}).`,
          );
        else if (keys.has(k))
          report(
            key.id,
            `${column(key)}: a chave “${k.slice(0, 40)}” se repete (ex.: linha ${r + 1}). Escolha outra coluna.`,
          );
        keys.add(k);
      }
      rows.push({ row: r + 1, values, original });
    }
    return { rows, issues };
  } catch (e) {
    if (e instanceof SheetIssues)
      throw new AppError(422, `${m.name} · ${e.issue.message}`, 'VALIDATION_ERROR', { ...e.issue });
    throw e;
  }
}
export function prepareImport(
  diagnosis: Diagnosis,
  config: Confirmation,
  existing: Map<string, ExistingDataset> = new Map(),
): Prepared[] {
  if (
    config.mappings.length !== diagnosis.sheets.length ||
    new Set(config.mappings.map((m) => m.sheetId)).size !== diagnosis.sheets.length
  )
    throw new AppError(422, 'Revise todas as abas, sem duplicações.');
  const targets = config.mappings.map((m) => m.datasetId).filter(Boolean);
  if (new Set(targets).size !== targets.length)
    throw new AppError(422, 'Duas abas não podem atualizar o mesmo conjunto.');
  const result: Prepared[] = [];
  for (const m of config.mappings) {
    const s = diagnosis.sheets.find((s) => s.id === m.sheetId);
    if (!s) throw new AppError(422, 'Aba desconhecida.');
    if (m.role === 'exclude' || m.role === 'report') continue;
    const target = m.datasetId ? existing.get(m.datasetId) : undefined;
    if (m.datasetId && !target)
      throw new AppError(422, `${m.name}: o conjunto a atualizar não pertence a este projeto.`);
    result.push({
      mapping: m,
      sheet: s,
      existing: target,
      rows: prepareSheet(s, m, config.locale, false, target).rows,
    });
  }
  if (!result.length || !result.some((s) => s.rows.length))
    throw new AppError(422, 'Selecione ao menos uma tabela com registros.');
  // Referências de abas que atualizam conjuntos existentes são resolvidas no banco, na publicação.
  for (const source of result.filter((r) => !r.existing))
    for (const f of source.mapping.fields.filter((f) => f.type === 'reference')) {
      const target = result.find((t) => t.mapping.sheetId === f.reference?.sheetId);
      const fail = (message: string) =>
        new AppError(422, `${source.mapping.name} · ${column(f)}: ${message}`, 'VALIDATION_ERROR', {
          sheetId: source.mapping.sheetId,
          fieldId: f.id,
          message,
        });
      if (!target || target.mapping.keyField !== f.reference?.fieldId)
        throw fail('o conjunto de destino precisa ser importado e ter esta chave única.');
      const keys = new Set(target.rows.map((r) => String(r.values[f.reference!.fieldId])));
      for (const r of source.rows)
        if (r.values[f.id] !== null && r.values[f.id] !== '' && !keys.has(String(r.values[f.id])))
          throw fail(
            `o valor “${String(r.values[f.id]).slice(0, 40)}” (linha ${r.row}) não existe em ${target.mapping.name}.`,
          );
    }
  return result;
}
