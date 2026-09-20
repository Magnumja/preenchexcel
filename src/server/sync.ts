import { eq } from 'drizzle-orm';
import { db } from './db';
import { datasets } from './schema';
import { AppError } from './values';
import { fetchSheetAsXlsx, type Fetcher } from './google-sheets';
import { parseFiles, prepareSheet } from './importer';
import { planReconcile, applyReconcile } from './reconcile';
import type { Mapping, ReconcilePlan, SyncState } from '../shared/contracts';
const normalize = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
/**
 * Mapeamento que a sincronização vai reutilizar: a mesma aba, as mesmas colunas → campos. Para um
 * conjunto recém-criado, cada coluna alimenta o campo de mesmo id.
 */
export function syncMappingFor(mapping: Mapping, datasetId: string): Mapping {
  return {
    ...mapping,
    datasetId,
    conflicts: 'keep',
    fields: mapping.fields.map((f) => ({ ...f, target: f.target ?? f.id })),
  };
}
/**
 * Relê o Google Sheets de origem e aplica apenas o que não conflita com edições feitas no Preenche.
 * Se o cabeçalho da aba mudou, nada é aplicado: a pessoa precisa revisar pelo assistente.
 */
export async function runSync(datasetId: string, fetchImpl?: Fetcher): Promise<SyncState> {
  const [d] = await db.select().from(datasets).where(eq(datasets.id, datasetId));
  if (!d) throw new AppError(404, 'Conjunto não encontrado.', 'NOT_FOUND');
  if (!d.sourceUrl || !d.syncMapping || !d.syncState?.userId)
    throw new AppError(422, 'Este conjunto não tem um Google Sheets de origem configurado.');
  const state: SyncState = { userId: d.syncState.userId, lastRunAt: new Date().toISOString() };
  try {
    const plan = await syncOnce(d, fetchImpl);
    Object.assign(state, { status: 'ok', plan, message: summarize(plan) });
  } catch (e) {
    Object.assign(state, {
      status: 'error',
      message: e instanceof AppError ? e.message : 'Falha inesperada na sincronização.',
    });
    if (!(e instanceof AppError)) console.error('sync_failed', { datasetId });
  }
  await db.update(datasets).set({ syncState: state }).where(eq(datasets.id, datasetId));
  return state;
}
async function syncOnce(d: typeof datasets.$inferSelect, fetchImpl?: Fetcher) {
  const mapping = d.syncMapping!;
  const sheet = await fetchSheetAsXlsx(d.sourceUrl!, fetchImpl);
  const diagnosis = await parseFiles([{ originalname: sheet.name, buffer: sheet.buffer }]);
  const source =
    diagnosis.sheets.find((s) => s.name === mapping.name) ??
    (diagnosis.sheets.length === 1 ? diagnosis.sheets[0] : undefined);
  if (!source)
    throw new AppError(422, `A aba “${mapping.name}” não existe mais na planilha de origem.`);
  const header = source.rows[mapping.headerRow - 1] ?? [];
  for (const f of mapping.fields.filter((f) => f.target))
    if (normalize(header[Number(f.id.slice(1)) - 1]?.value) !== normalize(f.source))
      throw new AppError(
        422,
        `O cabeçalho da planilha mudou (coluna ${f.id.slice(1)} era “${f.source}”). Use “Atualizar do Google Sheets” para revisar o mapeamento.`,
      );
  const current: Mapping = {
    ...mapping,
    sheetId: source.id,
    endRow: source.rows.length,
    conflicts: 'keep',
  };
  const { rows } = prepareSheet(source, current, 'pt-BR', false, d);
  return db.transaction(async (tx) => {
    const plan = await planReconcile(tx, d, current, rows);
    await applyReconcile(
      tx,
      d.syncState!.userId,
      d,
      { mapping: current, sheet: source, existing: d, rows },
      plan,
    );
    return plan.plan;
  });
}
const summarize = (p: ReconcilePlan) =>
  `${p.inserts} novos · ${p.updates} atualizados · ${p.unchanged} iguais · ${p.conflicts.length} mantidos por edição local · ${p.missing.length} ausentes mantidos`;
/** Agendador simples no processo: percorre os conjuntos com sincronização ligada, um por vez. */
export function startSyncScheduler(minutes: number) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const list = await db
        .select({ id: datasets.id })
        .from(datasets)
        .where(eq(datasets.syncEnabled, true));
      for (const { id } of list) await runSync(id).catch(() => undefined);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), minutes * 60000);
  timer.unref();
  return timer;
}
