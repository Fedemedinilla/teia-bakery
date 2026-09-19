// Espejo Google (Drive + Sheets) vía OAuth de la CUENTA DE LA CLIENTA — REST puro, sin SDK.
//
// Diseño para ser TRANSPORTABLE (requisito del estudio): todo el acople son 3 env vars
// (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN). La app auto-provisiona el resto:
// si no encuentra la carpeta raíz ni la planilla (marcadas con appProperties), las CREA
// en el Drive de la cuenta conectada. Cambiar de cuenta (handoff a la clienta) = re-consentir
// y pegar el refresh token nuevo — la estructura se reconstruye sola en su Drive.
//
// Scope: SOLO `drive.file` (el mínimo: la app ve únicamente archivos que ella misma creó).
// Ese scope también habilita la Sheets API sobre planillas creadas por la app.
// Por qué OAuth y no service account: los archivos de una SA le pertenecen a la SA, que en
// cuentas Gmail no tiene cuota (storageQuotaExceeded) — acá el dueño es la cuenta real.
import { env } from './supabase';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = 'Remitos Teia';
const SHEET_NAME = 'Teia — Pedidos (espejo)';

// Carpeta PLANA que la administradora comparte con la encargada del local para que imprima.
// El remito de cada pedido confirmado cae acá solo, además de ir al archivador por año/mes/comercio.
//
// ⚠️ Se encuentra SIEMPRE por la marca (teia_role='print'), nunca por el nombre: si la clienta la
// renombra o la mueve, la app la sigue encontrando. Si en cambio se creara una carpeta NUEVA, la
// que ella compartió quedaría huérfana y el local dejaría de ver remitos sin que nadie se entere.
// Ese es el modo de falla más caro de esta función, y por eso `ensurePrintFolder` es determinista.
const PRINT_NAME = 'Remitos para imprimir';
const PRINT_ROLE = 'print';
const PRINT_Q = `appProperties has { key='teia_role' and value='${PRINT_ROLE}' } and mimeType = 'application/vnd.google-apps.folder'`;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function gConfigured(): boolean {
  return Boolean(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET') && env('GOOGLE_OAUTH_REFRESH_TOKEN'));
}

// ---- access token (refresh flow) con cache en el módulo (sobrevive invocaciones warm) ----
let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.exp) return cached.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID') || '',
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET') || '',
      refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN') || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Google OAuth: no se pudo refrescar el token (${r.status}).`);
  const o: any = await r.json();
  cached = { token: o.access_token, exp: Date.now() + (Number(o.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}

async function gFetch(url: string, init: RequestInit = {}): Promise<any> {
  const t = await accessToken();
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

// ---- Drive: buscar / crear (todo idempotente por búsqueda previa) ----
const q = (s: string) => encodeURIComponent(s);
const escQ = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Búsqueda general. `driveFindOne` delega acá con los defaults de siempre (trashed=false,
// pageSize=2, sin orden), así que el camino que hoy funciona no cambia una letra.
// ⚠️ La URL se arma EXACTAMENTE como la armaba driveFindOne: `q` con encodeURIComponent (espacios
// como %20) y `fields` sin codificar. Con URLSearchParams los espacios saldrían como '+' y los
// paréntesis de `fields` percent-encodeados — otra petición, sobre el camino por el que pasan
// todas las confirmaciones de pedidos. Esto no es un capricho de estilo: es no mover lo que anda.
async function driveFind(
  query: string,
  opts: { trashed?: boolean; orderBy?: string; pageSize?: number } = {}
): Promise<any[]> {
  const filtro = `${query} and trashed = ${opts.trashed ? 'true' : 'false'}`;
  const orden = opts.orderBy ? `&orderBy=${q(opts.orderBy)}` : '';
  const o = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q(filtro)}&fields=files(id,name,webViewLink)&pageSize=${opts.pageSize ?? 2}${orden}`
  );
  return o.files || [];
}

async function driveFindOne(query: string): Promise<any | null> {
  return (await driveFind(query))[0] || null;
}

async function driveCreateFolder(name: string, parentId?: string, appProp?: string): Promise<any> {
  const body: any = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  if (appProp) body.appProperties = { teia_role: appProp };
  return gFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function ensureFolder(name: string, parentId?: string, appProp?: string): Promise<any> {
  const query = appProp
    ? `appProperties has { key='teia_role' and value='${appProp}' } and mimeType = 'application/vnd.google-apps.folder'`
    : `name = '${escQ(name)}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder'`;
  return (await driveFindOne(query)) || driveCreateFolder(name, parentId, appProp);
}

// Carpeta raíz auto-provisionada: Remitos Teia (marcada teia_role=root para reencontrarla).
export async function ensureRoot(): Promise<any> {
  return ensureFolder(ROOT_NAME, undefined, 'root');
}

// `Remitos Teia/2026/07 - Julio/<Comercio>/` — el prefijo numérico ordena los meses.
export async function ensureMonthClientPath(dateIso: string, clientName: string): Promise<string> {
  const parts = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(dateIso || Date.now()));
  const yy = parts.find((p) => p.type === 'year')!.value;
  // El padding se hace A MANO: con es-AR y solo {year, month}, Intl ignora el '2-digit' y
  // devuelve "7" en vez de "07" — y entonces Drive ordena 1, 10, 11, 12, 2, 3…
  const mm = parts.find((p) => p.type === 'month')!.value.padStart(2, '0');
  const root = await ensureRoot();
  const year = await ensureFolder(yy, root.id);
  // Solo el nombre del mes ("Julio"), sin el número delante: pedido de Mica en la Meet 02.
  // ⚠️ Efecto secundario: ordenadas por nombre quedan alfabéticas (Abril, Agosto, Diciembre…) y
  // no cronológicas. Se ordenan bien poniendo Drive en "Última modificación". Si algún día
  // molesta, se vuelve a `${mm} - ${nombre}` y las carpetas viejas conviven sin romper nada
  // (cada una se busca por su nombre exacto).
  const month = await ensureFolder(MESES[Number(mm) - 1] || mm, year.id);
  const safeName = String(clientName || 'Sin nombre').replace(/[\\/:*?"<>|]/g, '·').slice(0, 80).trim() || 'Sin nombre';
  const client = await ensureFolder(safeName, month.id);
  return client.id;
}

// Sube un PDF (idempotente: si ya existe uno con ese nombre en la carpeta, lo actualiza).
export async function driveUploadPdf(folderId: string, name: string, bytes: Uint8Array): Promise<string> {
  const existing = await driveFindOne(`name = '${escQ(name)}' and '${folderId}' in parents`);
  if (existing) {
    await gFetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/pdf' }, body: bytes as any,
    });
    return existing.id;
  }
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: 'application/pdf' });
  const boundary = 'teia' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Uint8Array([...new TextEncoder().encode(head), ...bytes, ...new TextEncoder().encode(tail)]);
  const o = await gFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as any,
  });
  return o.id;
}

// ---- Carpeta "Remitos para imprimir" (la que la clienta comparte con el local) ----

/**
 * Nombre de archivo seguro para Drive. Existe aparte del `safeName` de ensureMonthClientPath
 * porque este viaja a una carpeta PLANA donde conviven remitos de comercios distintos: acá el
 * nombre es lo único que distingue un archivo de otro, así que tiene que ser estable.
 * NFC porque los teclados de celular mandan acentos descompuestos: "Café" en NFD y en NFC son
 * dos strings distintos, y buscarían dos archivos distintos.
 */
export function driveSafeName(s: string, max = 60): string {
  const limpio = String(s ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E]/g, '')
    // La comilla simple entra acá por una razón que no es de Drive: el panel escribe este mismo
    // nombre en un atributo HTML pasándolo por `attrSafe`, que convierte < > " ' en espacio. Si el
    // archivo real conservara el apóstrofo, el atributo y el archivo NUNCA coincidirían, y el ✓
    // "en la carpeta" no se encendería jamás para un comercio como "Café Rivas' S.R.L.".
    // Se saca en el ORIGEN para que las dos representaciones no puedan divergir. El test lo fija.
    .replace(/[\\/:*?"<>|']/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
  // El recorte va por PUNTOS DE CÓDIGO, no por unidades UTF-16: `slice` puede partir un emoji al
  // medio y dejar media pareja suelta, que es un carácter inválido en el nombre de un archivo.
  const recortado = Array.from(limpio).slice(0, max).join('');
  return recortado.replace(/^[.\s]+|[.\s]+$/g, '') || 'Sin nombre';
}

/**
 * El nombre del remito dentro de la carpeta de impresión. FUENTE ÚNICA: la usan el archivador,
 * el endpoint del botón, el borrado de pedidos y el panel. Si dos de esos armaran el string por
 * su cuenta, una subida y su borrado (o su ✓) apuntarían a archivos distintos.
 * Lleva el comercio en el nombre porque la carpeta es plana: sin eso, "TEIA-0028" no le dice a
 * la encargada de quién es el pedido hasta abrirlo.
 */
export function printFileName(order: any): string {
  const num = order.order_number || '#' + order.id;
  const cuando = new Date(order.confirmed_at || order.created_at || NaN);
  // Fecha inválida → marca estable, NUNCA la de hoy: un nombre que cambia según cuándo se lo
  // calcula rompe el borrado y el ✓ del panel, que dependen de que dé siempre lo mismo.
  const fecha = isNaN(cuando.getTime())
    ? 'sin-fecha'
    : new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(cuando).replace(/\//g, '-');
  return `${driveSafeName(num, 20)} - ${fecha} - ${driveSafeName(order.client_name)}.pdf`;
}

/**
 * La carpeta de impresión, por MARCA. Determinista a propósito:
 *  · si hay varias marcadas (carrera de dos confirmaciones simultáneas), gana SIEMPRE la más
 *    vieja — que es la que la clienta compartió con el local.
 *  · si la marca solo aparece en la papelera, LANZA en vez de crear otra. Crear una segunda
 *    dejaría a la encargada mirando para siempre la carpeta compartida, que ya no recibe nada.
 *    Y restaurarla automáticamente tampoco: restaurar la carpeta restaura a sus hijos, o sea que
 *    resucitaría los remitos que la clienta acaba de imprimir y borrar.
 */
export async function ensurePrintFolder(): Promise<{ id: string; url: string }> {
  const link = (f: any) => f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`;

  const vivas = await driveFind(PRINT_Q, { orderBy: 'createdTime', pageSize: 10 });
  if (vivas.length) {
    if (vivas.length > 1) {
      console.warn(`[teia] hay ${vivas.length} carpetas de impresión marcadas; se usa la más vieja (${vivas[0].id}).`);
    }
    return { id: vivas[0].id, url: link(vivas[0]) };
  }

  const enPapelera = await driveFind(PRINT_Q, { trashed: true, pageSize: 1 });
  if (enPapelera.length) {
    throw new Error('La carpeta "Remitos para imprimir" está en la papelera de Drive. Restaurala desde Drive — si creo otra, la que compartiste con el local queda vacía para siempre.');
  }

  const root = await ensureRoot();
  const nueva = await driveCreateFolder(PRINT_NAME, root.id, PRINT_ROLE);
  return { id: nueva.id, url: link(nueva) };
}

/**
 * Promise.race contra un reloj, con el timer limpiado siempre (si no, en serverless el proceso se
 * queda vivo esperando un setTimeout que ya no le importa a nadie).
 *
 * ⚠️ REGLA: toda llamada a Drive que esté en el camino de una escritura a la base va envuelta acá.
 * `gFetch` usa `fetch` pelado, sin señal de aborto: con los valores por defecto de undici, una
 * respuesta que no llega se come los 30 s de la lambda entera. Un fallo de Google se atrapa con un
 * try/catch; un CUELGUE de Google, no — y ahí es donde una operación queda por la mitad.
 */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any;
  const reloj = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`Google no contestó en ${ms} ms`)), ms);
  });
  return Promise.race([p, reloj]).finally(() => clearTimeout(t)) as Promise<T>;
}

/**
 * Cuánto le queda a la función de sus 30 s (maxDuration en astro.config), menos una reserva para
 * contestar. Para darle a un paso de Google TODO el tiempo que sobra y no un tope fijo: con topes
 * fijos (12 + 12 s en el confirm) un espejo lento pero sano se cortaba a los 12 s aunque sobraran 15,
 * y withDeadline deja de esperar pero no cancela (verificación del 19/9).
 */
export function tiempoRestante(inicio: number, reserva = 3000): number {
  return Math.max(2000, 30000 - reserva - (Date.now() - inicio));
}

/** Sube (o pisa) un remito en la carpeta de impresión. Lanza: el que llama decide qué hacer. */
export async function uploadPrintCopy(name: string, bytes: Uint8Array): Promise<string> {
  const { id } = await ensurePrintFolder();
  return driveUploadPdf(id, name, bytes);
}

/**
 * Manda a la papelera la copia de impresión de un pedido. Para cuando el pedido deja de existir:
 * que el local imprima un remito de algo borrado es peor que no imprimir nada.
 * A diferencia de la subida, NO crea la carpeta si no existe — borrar no es motivo para crear.
 */
export async function trashPrintCopy(name: string): Promise<boolean> {
  const carpetas = await driveFind(PRINT_Q, { orderBy: 'createdTime', pageSize: 10 });
  if (!carpetas.length) return false;
  const archivo = await driveFindOne(`name = '${escQ(name)}' and '${carpetas[0].id}' in parents`);
  if (!archivo) return false;
  await gFetch(`https://www.googleapis.com/drive/v3/files/${archivo.id}?fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  });
  return true;
}

// ---- Sheets: planilla espejo auto-provisionada (marcada teia_role=sheet) ----
async function ensureSpreadsheet(): Promise<{ id: string; url: string; created: boolean }> {
  const found = await driveFindOne(`appProperties has { key='teia_role' and value='sheet' }`);
  if (found) return { id: found.id, url: found.webViewLink || `https://docs.google.com/spreadsheets/d/${found.id}`, created: false };
  const o = await gFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: SHEET_NAME, locale: 'es_AR', timeZone: 'America/Argentina/Buenos_Aires' } }),
  });
  const root = await ensureRoot();
  // marcarla + moverla adentro de la carpeta raíz (queda todo junto en el Drive de la clienta)
  await gFetch(`https://www.googleapis.com/drive/v3/files/${o.spreadsheetId}?addParents=${root.id}&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { teia_role: 'sheet' } }),
  });
  return { id: o.spreadsheetId, url: o.spreadsheetUrl, created: true };
}

type TabMeta = { sheetId: number; title: string; bandedIds: number[] };

async function sheetMeta(id: string): Promise<TabMeta[]> {
  const meta = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(sheetId,title),bandedRanges(bandedRangeId))`);
  return (meta.sheets || []).map((s: any) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    bandedIds: (s.bandedRanges || []).map((b: any) => b.bandedRangeId),
  }));
}

async function batchUpdate(id: string, requests: any[]): Promise<void> {
  if (!requests.length) return;
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
  });
}

async function ensureTabs(id: string, titles: string[]): Promise<TabMeta[]> {
  let tabs = await sheetMeta(id);
  const have = new Set(tabs.map((t) => t.title));
  const requests = titles.filter((t) => !have.has(t)).map((t) => ({ addSheet: { properties: { title: t } } }));
  if (requests.length) { await batchUpdate(id, requests); tabs = await sheetMeta(id); }
  return tabs;
}

// ---- diseño de la planilla (paleta cálida de la marca; idempotente en cada rebuild) ----
const C_TERRA = { red: 0.69, green: 0.408, blue: 0.298 };  // #B0684C
const C_WHITE = { red: 1, green: 1, blue: 1 };
const C_CREAM = { red: 0.984, green: 0.957, blue: 0.91 };  // #FBF4E8
const C_SOFT = { red: 0.941, green: 0.886, blue: 0.831 };  // #F0E2D4
const C_INK = { red: 0.2, green: 0.16, blue: 0.122 };      // #33291F
const MONEY = { type: 'NUMBER', pattern: '"$"#,##0' };

// Formato de una pestaña de DATOS: reset total (mata formatos viejos si la tabla se achicó),
// encabezado terracota congelado, filas cebradas crema/blanco, columnas de plata con $, y
// recorte (CLIP) en las columnas largas. IMPORTANTE: los ANCHOS solo se tocan la PRIMERA vez
// (withWidths=true al crear la planilla) — después son de la clienta y el rebuild no los pisa.
function tabFormat(t: TabMeta, rows: number, cols: number, moneyCols: number[], fixed: Record<number, number> = {}, withWidths = false): any[] {
  const reqs: any[] = [{ repeatCell: { range: { sheetId: t.sheetId }, cell: {}, fields: 'userEnteredFormat' } }];
  for (const bid of t.bandedIds) reqs.push({ deleteBanding: { bandedRangeId: bid } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: t.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  reqs.push({ repeatCell: {
    range: { sheetId: t.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
    cell: { userEnteredFormat: { backgroundColor: C_TERRA, textFormat: { foregroundColor: C_WHITE, bold: true, fontSize: 10 }, verticalAlignment: 'MIDDLE', padding: { top: 6, bottom: 6 } } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
  } });
  if (rows > 1) {
    reqs.push({ addBanding: { bandedRange: {
      range: { sheetId: t.sheetId, startRowIndex: 1, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols },
      rowProperties: { firstBandColor: C_CREAM, secondBandColor: C_WHITE },
    } } });
  }
  for (const c of moneyCols) {
    reqs.push({ repeatCell: {
      range: { sheetId: t.sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: MONEY } }, fields: 'userEnteredFormat.numberFormat',
    } });
  }
  for (const idx of Object.keys(fixed)) {
    reqs.push({ repeatCell: { range: { sheetId: t.sheetId, startRowIndex: 1, startColumnIndex: Number(idx), endColumnIndex: Number(idx) + 1 }, cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
  }
  if (withWidths) {
    reqs.push({ autoResizeDimensions: { dimensions: { sheetId: t.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: cols } } });
    for (const [idx, px] of Object.entries(fixed)) {
      reqs.push({ updateDimensionProperties: { range: { sheetId: t.sheetId, dimension: 'COLUMNS', startIndex: Number(idx), endIndex: Number(idx) + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
    }
  }
  return reqs;
}

// Formato del Resumen: títulos de sección destacados, subencabezados en negrita, plata en $.
function resumenFormat(t: TabMeta, sectionRows: number[], headRows: number[], withWidths = false): any[] {
  const reqs: any[] = [{ repeatCell: { range: { sheetId: t.sheetId }, cell: {}, fields: 'userEnteredFormat' } }];
  for (const bid of t.bandedIds) reqs.push({ deleteBanding: { bandedRangeId: bid } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: t.sheetId, gridProperties: { frozenRowCount: 0 } }, fields: 'gridProperties.frozenRowCount' } });
  for (const r of sectionRows) {
    reqs.push({ repeatCell: {
      range: { sheetId: t.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { backgroundColor: C_SOFT, textFormat: { foregroundColor: C_INK, bold: true, fontSize: 11 }, padding: { top: 8, bottom: 6 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,padding)',
    } });
  }
  for (const r of headRows) {
    reqs.push({ repeatCell: {
      range: { sheetId: t.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat',
    } });
  }
  reqs.push({ repeatCell: {
    range: { sheetId: t.sheetId, startColumnIndex: 2, endColumnIndex: 3 },
    cell: { userEnteredFormat: { numberFormat: MONEY } }, fields: 'userEnteredFormat.numberFormat',
  } });
  if (withWidths) reqs.push({ autoResizeDimensions: { dimensions: { sheetId: t.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 3 } } });
  return reqs;
}

async function writeTab(sheetId: string, tab: string, rows: any[][]): Promise<void> {
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${q(`'${tab}'!A:Z`)}:clear`, { method: 'POST' });
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${q(`'${tab}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }),
  });
}

// ---- el espejo: REBUILD completo desde la base (refleja también ediciones y borrados) ----
import { sbSelectTodoStrict } from './supabase';

const fmtDia = (s?: string) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
};
const mesDe = (s?: string) => {
  if (!s) return '';
  const p = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).formatToParts(new Date(s));
  return `${p.find((x) => x.type === 'year')?.value}-${p.find((x) => x.type === 'month')?.value}`;
};
// Semana LUNES a DOMINGO en hora argentina, con etiqueta legible (no "Semana 29" ISO).
const semanaDe = (s?: string): { k: string; label: string } => {
  if (!s) return { k: '', label: '' };
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s));
  const d = new Date(ymd + 'T00:00:00Z');
  if (isNaN(d.getTime())) return { k: '', label: '' };
  const lunes = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  const domingo = new Date(lunes.getTime() + 6 * 86400000);
  const dm = (x: Date) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  return { k: lunes.toISOString().slice(0, 10), label: `Semana del ${dm(lunes)} al ${dm(domingo)} · ${lunes.getUTCFullYear()}` };
};

export async function mirrorToSheet(): Promise<{ url: string }> {
  // TODAS las filas, de a páginas por rangos de id: Supabase corta cada respuesta en 1000 filas sin
  // avisar, y con `limit=8000` el Sheet perdía en silencio los pedidos viejos (ver sbSelectTodoStrict).
  // Vienen ordenadas por id; el orden de cada pestaña se arma acá.
  const [ordersPorId, itemsPorId, productsPorId, clientsPorId] = await Promise.all([
    sbSelectTodoStrict<any>('teia_orders'),
    sbSelectTodoStrict<any>('teia_order_items'),
    sbSelectTodoStrict<any>('teia_products'),
    sbSelectTodoStrict<any>('teia_clients'),
  ]);
  if (!ordersPorId || !itemsPorId || !productsPorId || !clientsPorId) throw new Error('No se pudo leer la base para el espejo.');
  const texto = (v: unknown) => String(v ?? '');
  const orders = [...ordersPorId].sort((a, b) => texto(b.created_at).localeCompare(texto(a.created_at)) || Number(b.id) - Number(a.id));
  const items = [...itemsPorId].sort((a, b) => Number(b.order_id) - Number(a.order_id) || Number(a.id) - Number(b.id));
  const products = [...productsPorId].sort((a, b) =>
    texto(a.category).localeCompare(texto(b.category), 'es') || texto(a.name).localeCompare(texto(b.name), 'es') || Number(a.id) - Number(b.id));
  const clients = [...clientsPorId].sort((a, b) => texto(a.business_name).localeCompare(texto(b.business_name), 'es') || Number(a.id) - Number(b.id));

  const { id: sheetId, url, created } = await ensureSpreadsheet();
  const TITLES = ['Pedidos', 'Ítems', 'Productos', 'Clientes', 'Resumen'];
  const tabs = await ensureTabs(sheetId, TITLES);
  const tabOf = (title: string) => tabs.find((t) => t.title === title)!;

  const byOrder: Record<string, any[]> = {};
  for (const it of items as any[]) (byOrder[it.order_id] ||= []).push(it);
  const numOf = (o: any) => o.order_number || `#${o.id}`;

  await writeTab(sheetId, 'Pedidos', [
    // "Cargado por" va AL FINAL (columna M): el link al remito se escribe aparte en L2:L y no se puede correr.
    ['Número', 'Fecha', 'Estado', 'Cliente', 'CUIT', 'Contacto', 'Dirección', 'Entrega', 'Desc %', 'Total', 'Notas', 'Remito', 'Cargado por'],
    ...(orders as any[]).map((o) => {
      const cli = (clients as any[]).find((c) => c.id === o.client_id);
      return [numOf(o), fmtDia(o.created_at), o.status, o.client_name, cli ? cli.cuit : '', o.client_contact,
        o.delivery_address, o.delivery_date || 'a coordinar', Number(o.discount_pct) || 0, Number(o.total) || 0,
        o.notes || '', '', o.placed_by === 'teia' ? 'Teia' : ''];
    }),
  ]);

  // Link al remito como fórmula HYPERLINK (clickeable de verdad): es VALOR, no formato,
  // así que el reset de estilos de cada rebuild no lo puede despintar. Apunta al proxy
  // gated por la clave del panel (el bucket es privado): Mica lo abre; un tercero que reciba
  // el Sheet reenviado, no.
  const appUrl = (env('TEIA_APP_URL') || 'https://teia-bakery.vercel.app').replace(/\/+$/, '');
  const linkRows = (orders as any[]).map((o) => [
    o.remito_cliente_url ? `=HYPERLINK("${appUrl}/api/admin/remito?id=${o.id}";"📄 Remito")` : '',
  ]);
  if (linkRows.length) {
    await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${q(`'Pedidos'!L2:L${linkRows.length + 1}`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: linkRows }),
    });
  }

  await writeTab(sheetId, 'Ítems', [
    ['Pedido', 'Fecha', 'Producto', 'Pack', 'Cantidad', 'P. unitario', 'Subtotal'],
    ...(orders as any[]).flatMap((o) => (byOrder[o.id] || []).map((it) => [
      numOf(o), fmtDia(o.created_at), it.name, it.pack_label || '', Number(it.qty) || 0, Number(it.unit_price) || 0, Number(it.line_total) || 0,
    ])),
  ]);

  await writeTab(sheetId, 'Productos', [
    ['Producto', 'Rubro', 'Pack', 'Precio', 'Stock', 'Visible'],
    ...(products as any[]).map((p) => [p.name, p.category || '', p.pack_label || '', Number(p.price) || 0, Number(p.stock) || 0, p.active === false ? 'no' : 'sí']),
  ]);

  await writeTab(sheetId, 'Clientes', [
    ['CUIT', 'Comercio', 'Contacto', 'Dirección', 'Desc %', 'Último pedido', 'Notas internas'],
    ...(clients as any[]).map((c) => [c.cuit, c.business_name, c.client_contact || '', c.delivery_address || '', Number(c.discount_pct) || 0, fmtDia(c.last_order_at), c.notes || '']),
  ]);

  // Resumen: totales por mes, por cliente y por producto — calculados acá (números exactos
  // de la base; los pedidos anulados/borrados no aparecen porque ya no están en la base).
  const conf = (orders as any[]).filter((o) => o.status === 'confirmado' || o.status === 'entregado');
  const porMes = new Map<string, { n: number; t: number }>();
  const porSemana = new Map<string, { label: string; n: number; t: number }>();
  const porCliente = new Map<string, { n: number; t: number }>();
  for (const o of conf) {
    const cuando = o.confirmed_at || o.created_at;
    const m = mesDe(cuando);
    const w = semanaDe(cuando);
    const c = o.client_name || '—';
    porMes.set(m, { n: (porMes.get(m)?.n || 0) + 1, t: (porMes.get(m)?.t || 0) + (Number(o.total) || 0) });
    if (w.k) porSemana.set(w.k, { label: w.label, n: (porSemana.get(w.k)?.n || 0) + 1, t: (porSemana.get(w.k)?.t || 0) + (Number(o.total) || 0) });
    porCliente.set(c, { n: (porCliente.get(c)?.n || 0) + 1, t: (porCliente.get(c)?.t || 0) + (Number(o.total) || 0) });
  }
  const confIds = new Set(conf.map((o) => o.id));
  const porProducto = new Map<string, { u: number; t: number }>();
  for (const it of items as any[]) {
    if (!confIds.has(it.order_id)) continue;
    const k = it.name;
    porProducto.set(k, { u: (porProducto.get(k)?.u || 0) + (Number(it.qty) || 0), t: (porProducto.get(k)?.t || 0) + (Number(it.line_total) || 0) });
  }
  const anual = new Map<string, number>();
  for (const [m, v] of porMes) anual.set(m.slice(0, 4), (anual.get(m.slice(0, 4)) || 0) + v.t);

  // Resumen con índices rastreados para el diseño (títulos de sección y subencabezados).
  const resumen: any[][] = [];
  const sectionRows: number[] = [];
  const headRows: number[] = [];
  const section = (titulo: string, head: any[], rows: any[][]) => {
    if (resumen.length) resumen.push(['']);
    sectionRows.push(resumen.length); resumen.push([titulo, '', '']);
    headRows.push(resumen.length); resumen.push(head);
    resumen.push(...rows);
  };
  section('POR SEMANA (pedidos confirmados)', ['Semana', 'Pedidos', 'Total'],
    [...porSemana.entries()].sort().map(([, v]) => [v.label, v.n, v.t]));
  section('POR MES (pedidos confirmados)', ['Mes', 'Pedidos', 'Total'],
    [...porMes.entries()].sort().map(([m, v]) => [m, v.n, v.t]));
  section('POR AÑO', ['Año', '', 'Total'],
    [...anual.entries()].sort().map(([y, t]) => [y, '', t]));
  section('POR CLIENTE', ['Cliente', 'Pedidos', 'Total'],
    [...porCliente.entries()].sort((a, b) => b[1].t - a[1].t).map(([c, v]) => [c, v.n, v.t]));
  section('POR PRODUCTO', ['Producto', 'Unidades', 'Total'],
    [...porProducto.entries()].sort((a, b) => b[1].t - a[1].t).map(([p, v]) => [p, v.u, v.t]));
  // Los pedidos que armó la administradora (tarea 3): ya están sumados en todo lo de arriba; esto
  // dice cuántos de esos los cargó ella. Solo si hay alguno.
  const porMesTeia = new Map<string, { n: number; t: number }>();
  for (const o of conf) {
    if (o.placed_by !== 'teia') continue;
    const m = mesDe(o.confirmed_at || o.created_at);
    porMesTeia.set(m, { n: (porMesTeia.get(m)?.n || 0) + 1, t: (porMesTeia.get(m)?.t || 0) + (Number(o.total) || 0) });
  }
  if (porMesTeia.size) {
    section('CARGADOS POR TEIA (ya incluidos arriba)', ['Mes', 'Pedidos', 'Total'],
      [...porMesTeia.entries()].sort().map(([m, v]) => [m, v.n, v.t]));
  }
  await writeTab(sheetId, 'Resumen', resumen);

  // ---- diseño (idempotente: reset + re-aplicación en cada rebuild) ----
  const nOrders = (orders as any[]).length + 1;
  const nItems = (items as any[]).length + 1;
  const nProds = (products as any[]).length + 1;
  const nClients = (clients as any[]).length + 1;
  // Los anchos SOLO en la creación inicial (created): después son de la clienta y no se pisan.
  const fmt: any[] = [
    ...tabFormat(tabOf('Pedidos'), nOrders, 13, [9], { 6: 200, 10: 240, 11: 110 }, created),
    ...tabFormat(tabOf('Ítems'), nItems, 7, [5, 6], {}, created),
    ...tabFormat(tabOf('Productos'), nProds, 6, [3], {}, created),
    ...tabFormat(tabOf('Clientes'), nClients, 7, [], { 3: 200, 6: 220 }, created),
    ...resumenFormat(tabOf('Resumen'), sectionRows, headRows, created),
  ];
  // la pestaña vacía que Sheets crea por defecto ("Hoja 1"/"Sheet1") sobra: afuera
  const defaultTab = tabs.find((t) => !TITLES.includes(t.title) && /^(hoja|sheet)\s*\d+$/i.test(t.title));
  if (defaultTab) fmt.push({ deleteSheet: { sheetId: defaultTab.sheetId } });
  await batchUpdate(sheetId, fmt);

  return { url };
}

// Espejo "best effort" para colgar de acciones del panel: nunca rompe la acción principal.
export async function tryMirror(): Promise<void> {
  if (!gConfigured()) return;
  try { await mirrorToSheet(); } catch (e: any) { console.warn('[teia] espejo Sheet falló:', (e && e.message) || e); }
}

// Links para los botones del panel (si todo existe ya, no crea nada).
export async function googleStatus(): Promise<{
  connected: boolean; sheetUrl?: string; driveUrl?: string;
  printUrl?: string; printCount?: number; printNames?: string[];
  printTrashed?: boolean; printDupes?: boolean; printError?: boolean; printTruncated?: boolean;
}> {
  if (!gConfigured()) return { connected: false };
  try {
    const sheet = await driveFindOne(`appProperties has { key='teia_role' and value='sheet' }`);
    const root = await driveFindOne(`appProperties has { key='teia_role' and value='root' } and mimeType = 'application/vnd.google-apps.folder'`);
    const base = {
      connected: true,
      sheetUrl: sheet ? `https://docs.google.com/spreadsheets/d/${sheet.id}` : undefined,
      driveUrl: root ? `https://drive.google.com/drive/folders/${root.id}` : undefined,
    };

    // La carpeta de impresión va en su PROPIO try. Es información de apoyo: si la lectura falla,
    // los links a Drive y a la planilla —que ella usa todos los días— tienen que seguir saliendo.
    // El catch de afuera devuelve { connected: false } y le escondería los tres botones.
    //
    // Los NOMBRES de lo que hay adentro son lo que le deja al panel poner el ✓ "en la carpeta"
    // pedido por pedido. La verdad de si un remito está para imprimir vive en la carpeta, no en
    // nuestra base: una columna diría "lo subí" aunque la clienta lo haya borrado hace una hora.
    try {
      const vivas = await driveFind(PRINT_Q, { orderBy: 'createdTime', pageSize: 10 });
      if (vivas.length) {
        const carpeta = vivas[0];
        // 1000 es el máximo que acepta Drive por página. No se pagina: a su volumen (ella vacía la
        // carpeta cada semana) llegar a mil archivos sería años. Pero si alguna vez pasa, el
        // listado quedaría corto y los ✓ dejarían de salir sin motivo aparente — por eso, si
        // vuelve la página llena, se avisa en vez de mentir en silencio.
        const TOPE = 1000;
        const dentro = await driveFind(`'${carpeta.id}' in parents`, { pageSize: TOPE });
        return {
          ...base,
          printUrl: carpeta.webViewLink || `https://drive.google.com/drive/folders/${carpeta.id}`,
          printCount: dentro.length,
          printNames: dentro.map((f: any) => f.name),
          ...(vivas.length > 1 ? { printDupes: true } : {}),
          ...(dentro.length >= TOPE ? { printTruncated: true } : {}),
        };
      }
      // Sin carpeta viva: puede ser que todavía no exista (normal antes del primer pedido) o que
      // la hayan mandado a la papelera (hay que avisarle, porque el local dejó de recibir).
      const enPapelera = await driveFind(PRINT_Q, { trashed: true, pageSize: 1 });
      if (enPapelera.length) return { ...base, printTrashed: true };
    } catch (e: any) {
      console.warn('[teia] no se pudo leer la carpeta de impresión:', (e && e.message) || e);
      // ⚠️ "No pude leer la carpeta" NO puede verse igual que "no hay nada en la carpeta".
      // Sin esta marca, un fallo de lectura apaga todos los ✓ del panel y la regla que se le
      // enseñó a Mica —"los pedidos de hoy tienen que tener el ✓"— la haría reenviar a mano
      // remitos que ya estaban. Es el mismo error de [] vs null que ya costó caro en este repo.
      return { ...base, printError: true };
    }

    return base;
  } catch {
    return { connected: false };
  }
}
