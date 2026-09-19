// El umbral de ENVÍO SIN CARGO de cada lista.
//
// Antes esto era el "pedido mínimo": si no llegabas, no podías confirmar. Eso no era lo que
// pasa en la realidad de Teia. Palabras de la clienta: "el mínimo para lista general es
// $140.000 sino se cobra envío", y "por lo general hacen pedido para llevar al mínimo".
// O sea: el número no impide comprar, decide quién paga el flete. Bloquear el pedido le hacía
// perder ventas que ella igual habría aceptado cobrando el envío aparte.
//
// El costo del envío NO vive acá: varía por zona y lo carga ella al confirmar, en el remito.
import { CATALOGS, catalogOf } from './catalogs';
import { numeroDe, readSettings, type Ajustes } from './settings';
import { sbSelect, supaConfigured } from './supabase';

/** Valores por defecto: los que dio la clienta. Se usan hasta que corra el SQL de teia_settings,
 *  y como red de seguridad si esa consulta falla. A partir de ahí manda lo que ella cargue. */
const POR_DEFECTO: Record<string, number> = {
  general: 140000,
  // ⚠️ Era 250.000, y fue un error nuestro (agosto): se leyó "Chungo Pilar paga el envío hasta
  // $250.000" como si fuera para TODA la lista Chungo. La clienta lo corrigió el 14/9: los locales de
  // Chungo son $140.000 como la lista general, y SOLO Pilar es $250.000. Lo de Pilar es una
  // excepción de ESE comercio (teia_clients.envio_min), no de la lista. Ver umbralDelCliente.
  chungo: 140000,
};

/** La clave se arma desde la lista CERRADA de catálogos: nada arbitrario entra a la tabla. */
export function claveUmbral(catalog: string): string {
  return 'envio_min_' + catalogOf(catalog);
}

export function umbralDe(ajustes: Ajustes, catalog: string): number {
  const slug = catalogOf(catalog);
  return numeroDe(ajustes, claveUmbral(slug), POR_DEFECTO[slug] ?? POR_DEFECTO.general);
}

/**
 * La excepción propia de un comercio, o `null` si no tiene (o si lo que hay no es un monto válido).
 *
 * ⚠️ El cuidado está todo en el `null`. `Number(null)` y `Number('')` dan 0, y 0 acá es un valor
 * VÁLIDO que significa "envío sin cargo siempre". Un comercio sin excepción que pasara por un
 * `Number(...)` descuidado terminaría con el envío regalado, en silencio. Por eso vacío se detecta
 * ANTES de convertir, y cualquier cosa que no sea un monto >= 0 cuenta como "sin excepción" — el
 * error que no perjudica a Teia.
 */
export function excepcionDe(client: { envio_min?: unknown } | null | undefined): number | null {
  const crudo = client?.envio_min;
  if (crudo === null || crudo === undefined) return null;
  if (typeof crudo === 'string' && crudo.trim() === '') return null;
  if (typeof crudo !== 'number' && typeof crudo !== 'string') return null;
  const n = Number(crudo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * El umbral que aplica a UN comercio: su excepción si la tiene, y si no el de su lista.
 * Sin cliente (un pedido cuya cuenta se borró) cae a la lista general, igual que antes.
 */
export function umbralDelCliente(
  ajustes: Ajustes,
  client: { catalog?: string; envio_min?: unknown } | null | undefined
): number {
  const propia = excepcionDe(client);
  if (propia !== null) return propia;
  return umbralDe(ajustes, client?.catalog || 'general');
}

/**
 * El umbral que ve en su catálogo el comercio de ESTA sesión: el suyo si tiene, si no el de su lista.
 *
 * ⚠️ Lee `envio_min` en una consulta APARTE y NO ESTRICTA, nunca sumándolo a la consulta de la
 * cuenta que hace el catálogo. Esa es estricta y pide columnas explícitas: si le agregáramos esta y
 * el SQL de la columna no estuviera corrido, PostgREST rechazaría la consulta ENTERA y ningún
 * comercio podría ver el catálogo — lo que pasó en julio con `access_code` en el login.
 * Así, si la columna falta o la consulta falla, esto cae al de su lista y el catálogo abre igual.
 * El costo, dicho: ante un hipo de la base, Pilar vería un rato el de su lista en vez del suyo. Es
 * aceptable porque el umbral es informativo y nunca bloquea un pedido.
 *
 * Sin sesión de comercio (la vista previa del panel) no consulta: ve el de la lista. Las dos
 * lecturas van en paralelo, así el catálogo no suma una ida y vuelta a la base.
 * Vive acá y no en la página para poder probarla: es la protección más importante del cambio.
 */
export async function umbralDeSesion(sessionId: number | null | undefined, catalog: string): Promise<number> {
  const [ajustes, filas] = await Promise.all([
    readSettings(),
    supaConfigured() && sessionId
      ? sbSelect(`teia_clients?id=eq.${Number(sessionId)}&select=envio_min`)
      : Promise.resolve([] as any[]),
  ]);
  return umbralDelCliente(ajustes, { catalog, envio_min: (filas as any[])[0]?.envio_min });
}

/**
 * Lee el monto que la administradora escribe en la ficha de un comercio. ESTRICTO a propósito.
 *
 *   ''  / '   '                         → { ok, valor: null }  (sin excepción: usa su lista)
 *   '250000' / '250.000' / '$ 250.000'  → { ok, valor: 250000 }
 *   '1.000.000'                         → { ok, valor: 1000000 }
 *   '0'                                 → { ok, valor: 0 }     (envío sin cargo siempre: VÁLIDO)
 *   '1e5' / '-5000' / '250,5' / 'abc' / '250 mil'          → { ok: false }
 *   '1.5' / '250000.00' / '2.50.000' / '25.0000' / '1 4 0' → { ok: false }
 *
 * La forma aceptada es una sola: un "$" opcional, y después dígitos pelados o dígitos con puntos
 * de miles BIEN FORMADOS (grupos de tres). Todo lo demás se rechaza y ella ve el error.
 *
 * ⚠️ Dos agujeros que ya pasaron por acá, los dos con el mismo resultado —un monto que nadie
 * escribió, guardado sin error ni aviso—:
 *  · `montoEscrito` (el parser del saldo del remito, hasta el 19/9) se comía la "e": "1e5" daba 15. Por eso no se
 *    reusa: está hecho para otro campo, que acepta negativos y decimales.
 *  · La primera versión de ESTA función borraba todos los puntos "porque son de miles", y "1.5"
 *    daba 15 — envío gratis desde $15 — y "250000.00" daba 25 millones. Lo encontraron cuatro
 *    revisores por separado. Por eso el punto se valida por su POSICIÓN y no se borra a ciegas.
 * La misma función valida los montos de las listas (api/admin/settings.ts).
 */
export function parseEnvioMin(v: unknown): { ok: true; valor: number | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, valor: null };
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 && v <= 99_999_999 ? { ok: true, valor: v } : { ok: false };
  }
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if (s === '') return { ok: true, valor: null };
  const m = s.match(/^\$?\s*(\d+|\d{1,3}(?:\.\d{3})+)$/);
  if (!m) return { ok: false };
  const n = Number(m[1].replace(/\./g, ''));
  return n <= 99_999_999 ? { ok: true, valor: n } : { ok: false };
}

/**
 * Los comercios que NO siguen el monto de su lista, para mostrarlos en la pestaña Envíos. Existe
 * para que se entienda por qué un local (Chungo Pilar) ve otro número que el resto de su lista, y
 * para que cambiar la lista no se lea como "cambié a todos".
 */
export function excepcionesDe(
  ajustes: Ajustes,
  clients: Array<{ business_name?: string; catalog?: string; envio_min?: unknown; active?: boolean }>
): { nombre: string; monto: number; lista: string; montoLista: number; activo: boolean }[] {
  return (clients || [])
    .map((c) => ({ c, propia: excepcionDe(c) }))
    .filter((x) => x.propia !== null)
    .map(({ c, propia }) => {
      const slug = catalogOf(c.catalog || 'general');
      return {
        nombre: String(c.business_name || 'Sin nombre'),
        monto: propia as number,
        lista: CATALOGS.find((k) => k.slug === slug)?.label || slug,
        montoLista: umbralDe(ajustes, slug),
        activo: c.active !== false,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Todos los umbrales, para pintar la pestaña del panel. */
export function umbralesTodos(ajustes: Ajustes): { slug: string; label: string; monto: number }[] {
  return CATALOGS.map((c) => ({ slug: c.slug, label: c.label, monto: umbralDe(ajustes, c.slug) }));
}

export const claveUmbralValida = (k: string) => CATALOGS.some((c) => claveUmbral(c.slug) === k);
