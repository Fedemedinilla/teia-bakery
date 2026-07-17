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

async function driveFindOne(query: string): Promise<any | null> {
  const o = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q(query + ' and trashed = false')}&fields=files(id,name,webViewLink)&pageSize=2`);
  return (o.files && o.files[0]) || null;
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
  const mm = parts.find((p) => p.type === 'month')!.value;
  const root = await ensureRoot();
  const year = await ensureFolder(yy, root.id);
  const month = await ensureFolder(`${mm} - ${MESES[Number(mm) - 1] || mm}`, year.id);
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

// ---- Sheets: planilla espejo auto-provisionada (marcada teia_role=sheet) ----
async function ensureSpreadsheet(): Promise<{ id: string; url: string }> {
  const found = await driveFindOne(`appProperties has { key='teia_role' and value='sheet' }`);
  if (found) return { id: found.id, url: found.webViewLink || `https://docs.google.com/spreadsheets/d/${found.id}` };
  const o = await gFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: SHEET_NAME, locale: 'es_AR', timeZone: 'America/Argentina/Buenos_Aires' } }),
  });
  const root = await ensureRoot();
  // marcarla + moverla adentro de la carpeta raíz (queda todo junto en el Drive de la clienta)
  await gFetch(`https://www.googleapis.com/drive/v3/files/${o.spreadsheetId}?addParents=${root.id}&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { teia_role: 'sheet' } }),
  });
  return { id: o.spreadsheetId, url: o.spreadsheetUrl };
}

async function ensureTabs(sheetId: string, titles: string[]): Promise<void> {
  const meta = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(title))`);
  const have = new Set((meta.sheets || []).map((s: any) => s.properties.title));
  const requests = titles.filter((t) => !have.has(t)).map((t) => ({ addSheet: { properties: { title: t } } }));
  if (requests.length) {
    await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
    });
  }
}

async function writeTab(sheetId: string, tab: string, rows: any[][]): Promise<void> {
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${q(`'${tab}'!A:Z`)}:clear`, { method: 'POST' });
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${q(`'${tab}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }),
  });
}

// ---- el espejo: REBUILD completo desde la base (refleja también ediciones y borrados) ----
import { sbSelectStrict } from './supabase';

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

export async function mirrorToSheet(): Promise<{ url: string }> {
  const [orders, items, products, clients] = await Promise.all([
    sbSelectStrict(`teia_orders?select=*&order=created_at.desc&limit=2000`),
    sbSelectStrict(`teia_order_items?select=*&order=order_id.desc&limit=8000`),
    sbSelectStrict(`teia_products?select=*&order=category.asc,name.asc`),
    sbSelectStrict(`teia_clients?select=*&order=business_name.asc`),
  ]);
  if (!orders || !items || !products || !clients) throw new Error('No se pudo leer la base para el espejo.');

  const { id: sheetId, url } = await ensureSpreadsheet();
  await ensureTabs(sheetId, ['Pedidos', 'Ítems', 'Productos', 'Clientes', 'Resumen']);

  const byOrder: Record<string, any[]> = {};
  for (const it of items as any[]) (byOrder[it.order_id] ||= []).push(it);
  const numOf = (o: any) => o.order_number || `#${o.id}`;

  await writeTab(sheetId, 'Pedidos', [
    ['Número', 'Fecha', 'Estado', 'Cliente', 'CUIT', 'Contacto', 'Dirección', 'Entrega', 'Desc %', 'Total', 'Notas', 'Remito cliente', 'Hoja interna'],
    ...(orders as any[]).map((o) => {
      const cli = (clients as any[]).find((c) => c.id === o.client_id);
      return [numOf(o), fmtDia(o.created_at), o.status, o.client_name, cli ? cli.cuit : '', o.client_contact,
        o.delivery_address, o.delivery_date || 'a coordinar', Number(o.discount_pct) || 0, Number(o.total) || 0,
        o.notes || '', o.remito_cliente_url || '', o.remito_interno_url || ''];
    }),
  ]);

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
  const porCliente = new Map<string, { n: number; t: number }>();
  for (const o of conf) {
    const m = mesDe(o.confirmed_at || o.created_at);
    const c = o.client_name || '—';
    porMes.set(m, { n: (porMes.get(m)?.n || 0) + 1, t: (porMes.get(m)?.t || 0) + (Number(o.total) || 0) });
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
  await writeTab(sheetId, 'Resumen', [
    ['POR MES (pedidos confirmados)', '', ''], ['Mes', 'Pedidos', 'Total'],
    ...[...porMes.entries()].sort().map(([m, v]) => [m, v.n, v.t]),
    [''], ['POR AÑO', '', ''], ['Año', 'Total', ''],
    ...[...anual.entries()].sort().map(([y, t]) => [y, t, '']),
    [''], ['POR CLIENTE', '', ''], ['Cliente', 'Pedidos', 'Total'],
    ...[...porCliente.entries()].sort((a, b) => b[1].t - a[1].t).map(([c, v]) => [c, v.n, v.t]),
    [''], ['POR PRODUCTO', '', ''], ['Producto', 'Unidades', 'Total'],
    ...[...porProducto.entries()].sort((a, b) => b[1].t - a[1].t).map(([p, v]) => [p, v.u, v.t]),
  ]);

  return { url };
}

// Espejo "best effort" para colgar de acciones del panel: nunca rompe la acción principal.
export async function tryMirror(): Promise<void> {
  if (!gConfigured()) return;
  try { await mirrorToSheet(); } catch (e: any) { console.warn('[teia] espejo Sheet falló:', (e && e.message) || e); }
}

// Links para los botones del panel (si todo existe ya, no crea nada).
export async function googleStatus(): Promise<{ connected: boolean; sheetUrl?: string; driveUrl?: string }> {
  if (!gConfigured()) return { connected: false };
  try {
    const sheet = await driveFindOne(`appProperties has { key='teia_role' and value='sheet' }`);
    const root = await driveFindOne(`appProperties has { key='teia_role' and value='root' } and mimeType = 'application/vnd.google-apps.folder'`);
    return {
      connected: true,
      sheetUrl: sheet ? `https://docs.google.com/spreadsheets/d/${sheet.id}` : undefined,
      driveUrl: root ? `https://drive.google.com/drive/folders/${root.id}` : undefined,
    };
  } catch {
    return { connected: false };
  }
}
