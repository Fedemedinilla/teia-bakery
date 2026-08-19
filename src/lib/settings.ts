// Ajustes que edita la administradora desde el panel, sin redeploy y sin depender de nadie.
//
// Reemplazan a dos env vars de Vercel (TEIA_MIN_ORDER y TEIA_REQUIRE_CODE). El motivo es
// concreto: cada vez que Mica quería cambiar un número había que tocar Vercel y esperar un
// deploy, o sea que dependía de que alguien más estuviera disponible.
//
// ⚠️ SIEMPRE con sbSelect (la NO estricta). Si la tabla todavía no existe o Supabase tiene un
// hipo, devuelve [] y cada lector cae a su valor por defecto. Acá no se decide plata ni acceso:
// se decide qué frase se muestra. Una tabla que falta NUNCA puede dejar sin catálogo a 35
// comercios — que es exactamente lo que ya pasó una vez con una columna de una función apagada.
import { sbSelect, sbSelectStrict, supaConfigured } from './supabase';

export type Ajustes = Record<string, string>;

export async function readSettings(): Promise<Ajustes> {
  if (!supaConfigured()) return {};
  const filas = await sbSelect<any>('teia_settings?select=key,value');
  const m: Ajustes = {};
  for (const f of filas as any[]) {
    if (f && typeof f.key === 'string') m[f.key] = String(f.value ?? '');
  }
  return m;
}

/** Lee un número del mapa. Si falta, viene vacío o no es un número válido, devuelve el default. */
export function numeroDe(s: Ajustes, clave: string, porDefecto: number): number {
  const crudo = (s[clave] ?? '').trim();
  if (!crudo) return porDefecto;
  const n = Number(crudo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : porDefecto;
}

/**
 * Igual que readSettings pero ESTRICTA: devuelve null si no se pudo leer la tabla.
 *
 * Existe solo para el camino de ENTRADA. Con la lectura normal, un fallo pasajero devolvía {} y
 * `require_code` caía a su valor por defecto: el segundo factor se apagaba solo. Una decisión de
 * acceso no puede aflojarse porque una consulta tuvo un hipo — el que la usa corta con 503 en vez
 * de dejar entrar, igual que ya hace cuando no puede leer la cuenta.
 */
export async function readSettingsStrict(): Promise<Ajustes | null> {
  if (!supaConfigured()) return {};
  const filas = await sbSelectStrict<any>('teia_settings?select=key,value');
  if (filas === null) return null;
  const m: Ajustes = {};
  for (const f of filas as any[]) {
    if (f && typeof f.key === 'string') m[f.key] = String(f.value ?? '');
  }
  return m;
}
