import { AppError } from './values';
const MAX_BYTES = 5 * 1024 * 1024;
/** Extrai o id da planilha de um link do Google Sheets. Só docs.google.com é aceito. */
export function parseSheetsUrl(input: string): { id: string; canonical: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(422, 'Cole o link completo da planilha do Google Sheets.');
  }
  const m =
    url.hostname === 'docs.google.com' && url.pathname.match(/^\/spreadsheets\/d\/([\w-]{20,})/);
  if (!m) throw new AppError(422, 'O link precisa ser de uma planilha em docs.google.com.');
  return { id: m[1], canonical: `https://docs.google.com/spreadsheets/d/${m[1]}/edit` };
}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
/**
 * Baixa a planilha como XLSX pelo endpoint público de exportação. Funciona apenas para planilhas
 * compartilhadas como “qualquer pessoa com o link”; planilhas privadas devolvem a tela de login.
 */
export async function fetchSheetAsXlsx(
  input: string,
  fetchImpl: Fetcher = fetch,
): Promise<{ name: string; buffer: Buffer; canonical: string }> {
  const { id, canonical } = parseSheetsUrl(input);
  // A URL é montada aqui a partir do id validado, nunca a partir do texto da pessoa.
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  let response: Response;
  try {
    response = await fetchImpl(exportUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível acessar o Google Sheets agora. Tente novamente.');
  }
  const type = response.headers.get('content-type') || '';
  if (response.status === 401 || response.status === 403 || type.includes('text/html'))
    throw new AppError(
      422,
      'A planilha não está pública. No Google Sheets, use Compartilhar → “Qualquer pessoa com o link” (leitor) e tente de novo.',
    );
  if (response.status === 404) throw new AppError(422, 'Planilha não encontrada. Confira o link.');
  if (!response.ok)
    throw new AppError(502, `O Google Sheets respondeu com erro ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new AppError(413, 'A planilha excede o limite de 5 MB.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(502, 'Resposta vazia do Google Sheets.');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new AppError(413, 'A planilha excede o limite de 5 MB.');
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.subarray(0, 2).toString() !== 'PK')
    throw new AppError(
      422,
      'O Google Sheets não devolveu uma planilha. Confira o compartilhamento.',
    );
  const disposition = response.headers.get('content-disposition') || '';
  const nameMatch =
    disposition.match(/filename\*=UTF-8''([^;]+)/) || disposition.match(/filename="?([^";]+)/);
  const name = nameMatch
    ? decodeURIComponent(nameMatch[1]).replace(/\.xlsx$/i, '')
    : 'Planilha Google';
  return { name: name.slice(0, 190) + '.xlsx', buffer, canonical };
}
