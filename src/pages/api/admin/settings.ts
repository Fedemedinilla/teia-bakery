export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbUpsert, supaConfigured } from '../../../lib/supabase';
import { claveUmbralValida } from '../../../lib/envio';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: guardar los ajustes que edita la administradora (por ahora, los umbrales de envío
// sin cargo de cada lista).
//
// Solo se aceptan claves de una LISTA CERRADA. La tabla es clave/valor, así que sin esto
// cualquier POST podría sembrarla de filas basura o pisar un ajuste que mañana signifique algo
// más delicado. Mismo criterio que el descuento en /api/admin/order: la validación va en el
// servidor, no en el navegador.
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  const filas: { key: string; value: string }[] = [];

  for (const [k, v] of Object.entries(b || {})) {
    if (!claveUmbralValida(k)) continue; // silencioso: una clave desconocida simplemente no entra
    // Se sacan los puntos de miles y los espacios, porque ella escribe "140.000". Pero si después
    // de eso NO QUEDA NINGÚN DÍGITO, hay que rechazar: Number('') es 0, así que escribir "abc" o
    // dejarlo vacío guardaba el umbral en CERO — o sea "envío sin cargo siempre", en silencio y
    // para todos los comercios de esa lista.
    const digitos = String(v ?? '').replace(/[^\d]/g, '');
    if (!digitos) {
      return json({ error: 'Escribí el monto con números. Por ejemplo: 140000 o 140.000.' }, 400);
    }
    const n = Number(digitos);
    if (!Number.isFinite(n) || n > 99_999_999) {
      return json({ error: 'Ese monto es demasiado grande. Revisalo.' }, 400);
    }
    filas.push({ key: k, value: String(Math.round(n)) });
  }

  if (!filas.length) return json({ error: 'No llegó ningún monto para guardar.' }, 400);

  const ok = await sbUpsert('teia_settings', filas);
  if (!ok) {
    // El motivo casi siempre es que la tabla todavía no existe. Se dice, porque el mensaje
    // genérico manda a buscar el problema a cualquier lado menos al que es.
    return json({ error: 'No se pudo guardar. Puede que a la base le falte la tabla de ajustes: hay que correr supabase/2026-08-05-envios-remito-fotos.sql.' }, 500);
  }
  return json({ ok: true });
};
