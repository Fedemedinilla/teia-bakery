// Supabase REST helper (service_role, server-only). No SDK, no secrets in the repo — the
// credentials live only in Vercel env. Every helper degrades gracefully (returns empty/false)
// when Supabase isn't configured yet, so the app builds and runs before the project exists.

export function env(name: string): string | undefined {
  const proc = (globalThis as any).process;
  return (proc?.env?.[name] as string | undefined) ?? ((import.meta as any).env?.[name] as string | undefined);
}

export function supaConfigured(): boolean {
  return Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY'));
}

function base(): string {
  return (env('SUPABASE_URL') || '').replace(/\/+$/, '');
}
function key(): string {
  return env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export function sb(path: string): string {
  return `${base()}/rest/v1/${path}`;
}
export function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...extra };
}

// SELECT — returns rows, or [] on any failure (storefront keeps working).
export async function sbSelect<T = any>(path: string): Promise<T[]> {
  if (!supaConfigured()) return [];
  try {
    const r = await fetch(sb(path), { headers: sbHeaders() });
    if (!r.ok) return [];
    return (await r.json()) as T[];
  } catch {
    return [];
  }
}

// SELECT estricto — igual que sbSelect pero distingue el fallo: null si el request falló
// (red/5xx), [] solo cuando el server respondió OK sin filas. Para flujos donde "no hay filas"
// y "no pude leer" no pueden confundirse (plata, stock, archivado).
export async function sbSelectStrict<T = any>(path: string): Promise<T[] | null> {
  if (!supaConfigured()) return null;
  try {
    const r = await fetch(sb(path), { headers: sbHeaders() });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

// SELECT estricto de TODAS las filas de una tabla, de a páginas.
//
// ⚠️ PostgREST corta cada respuesta en `db-max-rows` (1000 en Supabase) y lo hace SIN AVISAR: un
// `limit=8000` devuelve 1000 filas con un 200 normal. El espejo del Sheet pedía `limit=8000` de
// ítems y `limit=2000` de pedidos, así que cuando la base pasara las 1000 líneas, la pestaña Ítems
// y el resumen POR PRODUCTO iban a perder en silencio los pedidos viejos (auditoría del 19/9).
//
// Pagina por RANGOS DE ID ("los próximos 1000 con id mayor que el último que vi"), no por offset: con
// offset, una fila borrada entre dos páginas corría a las demás y una que seguía existiendo se
// salteaba en silencio (segunda auditoría del 19/9). Con rangos de id no se pisa ni se saltea nada,
// y si el tope de la base fuera menor que la página, igual recorre todo (termina con una página
// vacía, no con una "corta"). El orden que devuelve es por id: el que llama ordena como quiera.
// `consulta` va SIN order, limit ni offset, y si nombra columnas tiene que incluir `id`.
// null si falla cualquier página: nunca devuelve una lectura a medias.
export async function sbSelectTodoStrict<T = any>(tabla: string, consulta = 'select=*', pagina = 1000, maxPaginas = 500): Promise<T[] | null> {
  if (/(^|&)(order|limit|offset)=/.test(consulta)) throw new Error('sbSelectTodoStrict: la consulta no lleva order, limit ni offset');
  const todas: T[] = [];
  let ultimo: unknown = null;
  for (let i = 0; i < maxPaginas; i++) {
    const desde = ultimo === null ? '' : `&id=gt.${encodeURIComponent(String(ultimo))}`;
    const filas = await sbSelectStrict<T>(`${tabla}?${consulta}${desde}&order=id.asc&limit=${pagina}`);
    if (filas === null) return null;
    if (!filas.length) return todas;
    todas.push(...filas);
    const id = (filas[filas.length - 1] as any)?.id;
    if (id === undefined || id === null) return null; // sin id no se puede seguir por rangos
    ultimo = id;
  }
  return null; // más de maxPaginas páginas: mejor fallar que devolver a medias
}

// PATCH que devuelve las filas afectadas (return=representation), o null si el request falló.
// Con un filtro condicional (ej. `&status=eq.pendiente`) funciona como claim atómico:
// [] = otra request ganó la carrera (o el filtro no matcheó), null = fallo de transporte.
export async function sbPatchReturning<T = any>(path: string, body: unknown): Promise<T[] | null> {
  if (!supaConfigured()) return null;
  try {
    const r = await fetch(sb(path), {
      method: 'PATCH',
      headers: sbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

// INSERT — returns the created row(s) (return=representation), or null on failure.
export async function sbInsert<T = any>(table: string, body: unknown): Promise<T[] | null> {
  if (!supaConfigured()) return null;
  try {
    const r = await fetch(sb(table), {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

// UPSERT — inserta o pisa la fila existente segun la primary key. Devuelve true si salio bien.
//
// Existe para la tabla de ajustes (clave/valor): con insert habria que saber de antemano si la
// clave ya estaba, y con patch no se crearia la primera vez. El "resolution=merge-duplicates" es
// la forma de PostgREST de decirle a Postgres "on conflict do update".
export async function sbUpsert(table: string, body: unknown): Promise<boolean> {
  if (!supaConfigured()) return false;
  try {
    const r = await fetch(sb(table), {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// PATCH — returns true on success.
export async function sbPatch(path: string, body: unknown): Promise<boolean> {
  if (!supaConfigured()) return false;
  try {
    const r = await fetch(sb(path), {
      method: 'PATCH',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// PATCH que además dice POR QUÉ falló: el código de PostgREST del cuerpo del error.
//
// Existe porque sbPatch tira el cuerpo, y entonces "a la base le falta una columna" (PGRST204),
// "ese CUIT ya está en otra cuenta" (23505) y un hipo de red se ven exactamente igual. Cuando el
// que llama tiene que reaccionar distinto a cada uno —reintentar sin la columna nueva en un caso,
// avisar del CUIT repetido en otro— necesita saber cuál fue. No reemplaza a sbPatch, que tiene
// muchos usos a los que les alcanza el booleano.
//   status 0 = no hubo respuesta (red caída o timeout)
export async function sbPatchDetalle(
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; code?: string }> {
  if (!supaConfigured()) return { ok: false, status: 0 };
  try {
    const r = await fetch(sb(path), {
      method: 'PATCH',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, status: r.status };
    let code: string | undefined;
    try { code = (await r.json())?.code; } catch { /* cuerpo que no es JSON: sin código */ }
    return { ok: false, status: r.status, code };
  } catch {
    return { ok: false, status: 0 };
  }
}

// Llama a una función SQL (POST /rest/v1/rpc/<nombre>) y devuelve TODO lo que hace falta para
// reaccionar bien: el resultado, o el status y el código de PostgREST. La usa el armado de pedidos
// (teia_armar_pedido), donde cada salida tiene un mensaje distinto:
//   · ok              → { ok, data }
//   · status 404 + PGRST202 → la función no existe (el SQL no se corrió): no se creó nada
//   · status 4xx con código → la base lo rechazó (un dato inválido): no se creó nada
//   · status 0 o 5xx   → NO SE SABE si entró (sin respuesta, o se cortó): el que llama tiene que
//                        poder reintentar sin duplicar (por eso la función es idempotente)
// Con tope de tiempo (`ms`): un fetch sin tope se come los 30 s de la función y el panel recibe un
// 504 sin saber nada; con tope, el que llama lo trata como "no sé" y contesta a tiempo.
export async function sbRpc<T = any>(
  nombre: string,
  args: unknown,
  ms = 15000
): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string }> {
  if (!supaConfigured()) return { ok: false, status: 0 };
  try {
    const r = await fetch(sb(`rpc/${nombre}`), {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(ms),
    });
    if (r.ok) return { ok: true, data: (await r.json()) as T };
    let code: string | undefined;
    try { code = (await r.json())?.code; } catch { /* cuerpo que no es JSON: sin código */ }
    return { ok: false, status: r.status, code };
  } catch {
    return { ok: false, status: 0 };
  }
}

// DELETE — returns true on success.
export async function sbDelete(path: string): Promise<boolean> {
  if (!supaConfigured()) return false;
  try {
    const r = await fetch(sb(path), { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=minimal' }) });
    return r.ok;
  } catch {
    return false;
  }
}

// DELETE que devuelve las filas borradas (return=representation), o null si el request falló. Con
// un filtro condicional (`&status=eq.pendiente`) funciona como el claim de sbPatchReturning:
// [] = no había nada que borrar con esa condición (otro lo cambió o lo borró antes).
export async function sbDeleteReturning<T = any>(path: string): Promise<T[] | null> {
  if (!supaConfigured()) return null;
  try {
    const r = await fetch(sb(path), { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=representation' }) });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

// UPLOAD a Storage — sube bytes a un bucket. Devuelve el PATH del objeto (no una URL) en
// éxito, o null si falla. El path sirve tanto para armar la URL pública (bucket público, ej.
// fotos) como para pedir una URL firmada (bucket privado, ej. remitos — ver sbSignedUrl).
// x-upsert:true → idempotente: reintentar con el mismo path sobreescribe, no duplica.
export async function sbUpload(bucket: string, path: string, bytes: Uint8Array | Buffer, contentType: string): Promise<string | null> {
  if (!supaConfigured()) return null;
  const url = base(), k = key();
  try {
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes as any,
    });
    return r.ok ? path : null;
  } catch {
    return null;
  }
}

// El PATH del objeto a partir de lo que guarda `remito_cliente_url`. Hoy ahí va el path pelado,
// pero los remitos VIEJOS guardaron la URL pública entera: si trae el prefijo del bucket, se
// recorta. Vive acá —y no copiada en cada endpoint— porque dos lecturas distintas del mismo
// campo terminarían buscando dos objetos distintos. El valor sale SIEMPRE de la base.
export function storagePath(stored: string, bucket = 'teia-remitos'): string {
  const marker = `/${bucket}/`;
  const s = String(stored ?? '');
  return s.includes(marker) ? s.slice(s.indexOf(marker) + marker.length).split('?')[0] : s;
}

// DESCARGA los bytes de un objeto privado, server-to-server con la service key. Devuelve null
// ante cualquier fallo, como sus hermanas.
//
// No usa `sbSignedUrl`: firmar una URL abre una ventana de 2 minutos en la que ese remito es
// legible por cualquiera que la tenga. Acá el que lee es el propio servidor, así que no hace
// falta abrir nada — el bucket sigue tan privado como estaba.
export async function sbDownload(bucket: string, path: string): Promise<Uint8Array | null> {
  if (!supaConfigured() || !path) return null;
  const k = key();
  try {
    const r = await fetch(`${base()}/storage/v1/object/${bucket}/${path}`, {
      headers: { apikey: k, Authorization: `Bearer ${k}` },
    });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// URL FIRMADA temporal para un objeto de un bucket PRIVADO. Devuelve la URL absoluta que
// sirve el archivo durante `expiresIn` segundos, o null si falla. Se genera on-demand con la
// service key (server-only) — así los remitos (que tienen datos del comercio) no quedan en un
// bucket público con URL permanente. `path` sale SIEMPRE de la base, nunca del cliente.
export async function sbSignedUrl(bucket: string, path: string, expiresIn = 120): Promise<string | null> {
  if (!supaConfigured() || !path) return null;
  const url = base(), k = key();
  try {
    const r = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const o: any = await r.json();
    // La API devuelve un path relativo tipo "/object/sign/<bucket>/<path>?token=..."
    return o?.signedURL ? `${url}/storage/v1${o.signedURL}` : null;
  } catch {
    return null;
  }
}
