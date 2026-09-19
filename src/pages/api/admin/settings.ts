export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbUpsert, sbSelectStrict, supaConfigured } from '../../../lib/supabase';
import { claveUmbralValida, parseEnvioMin } from '../../../lib/envio';
import { normCode } from '../../../lib/accesscode';
import { PANEL_VIEJO, esPanelNuevo } from '../../../lib/panel';

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

  // Los montos de las listas solo del panel nuevo (lib/panel.ts): el viejo manda TODAS las listas
  // con lo que su pantalla mostraba, y desde una pantalla vieja devolvía Chungo a $250.000.
  if (Object.keys(b || {}).some(claveUmbralValida) && !esPanelNuevo(b)) {
    return json({ error: PANEL_VIEJO }, 409);
  }

  // ── El interruptor de CUIT + contraseña ────────────────────────────────────────────────────
  // Es el ajuste más delicado de la app: decide QUIÉN PUEDE ENTRAR. Dos guardas.
  if ('require_code' in (b || {})) {
    const encender = b.require_code === true || String(b.require_code) === 'true';

    if (encender) {
      // GUARDA 1 — la columna tiene que existir. Sin ella, entrar.ts pide 'access_code' y
      // PostgREST corta la consulta ENTERA: la puerta devuelve 503 y NO ENTRA NADIE, ni los que
      // sí tienen contraseña. Es el modo de falla más caro posible, así que se sondea primero.
      const sonda = await sbSelectStrict('teia_clients?select=access_code&limit=1');
      if (sonda === null) {
        console.warn('[teia] falta teia_clients.access_code: correr supabase/2026-08-05-envios-remito-fotos.sql');
        return json({ error: 'No se puede encender: a la base le falta una actualización. Avisá a soporte y probá de nuevo cuando esté.' }, 409);
      }

      // GUARDA 2 — cuántos comercios habilitados quedarían sin poder entrar. El sistema falla
      // CERRADO a propósito: una cuenta sin contraseña no entra. Y no se nota en el momento
      // (las sesiones duran 90 días), así que el comercio se entera semanas después al cambiar
      // de teléfono, cuando ya nadie lo asocia con este cambio.
      // Se traen TODAS las habilitadas y se filtra acá, no en la base. Con un filtro de
      // PostgREST habría que escribir "es null O es cadena vacía", y eso deja pasar una
      // contraseña de SOLO ESPACIOS: la base la ve distinta de '', pero al entrar normCode la
      // deja en nada y el comercio no puede entrar igual. La guarda tiene que usar exactamente
      // el mismo criterio que el login, o promete algo que después no se cumple.
      const sin = await sbSelectStrict('teia_clients?active=not.is.false&select=id,business_name,access_code');
      if (sin === null) {
        return json({ error: 'No se pudo revisar qué cuentas tienen contraseña. No se encendió nada: probá de nuevo en un momento.' }, 503);
      }
      const faltantes = (sin as any[]).filter((c) => !normCode(c.access_code));
      if (faltantes.length && b.confirmo_lockout !== true) {
        return json({
          error: `Hay ${faltantes.length} cuenta${faltantes.length === 1 ? '' : 's'} habilitada${faltantes.length === 1 ? '' : 's'} sin contraseña. Si encendés ahora, no van a poder entrar.`,
          cuentas_sin_contrasenia: faltantes.map((c) => c.business_name).slice(0, 20),
          necesita_confirmacion: true,
        }, 409);
      }
    }

    filas.push({ key: 'require_code', value: encender ? 'true' : 'false' });
  }

  for (const [k, v] of Object.entries(b || {})) {
    if (k === 'require_code' || k === 'confirmo_lockout') continue; // ya resueltos arriba
    if (!claveUmbralValida(k)) continue; // silencioso: una clave desconocida simplemente no entra
    // El mismo lector estricto que el monto propio de cada comercio (lib/envio.ts). Antes acá se
    // borraba TODO lo que no fuera dígito, y eso guardaba montos que ella no escribió, sin error:
    // "1e5" → 15 (envío gratis desde $15 para toda la lista), "140000.00" → 14.000.000, "1,5" → 15.
    // Y además: vacío NO vale acá. Una lista siempre tiene su monto; Number('') es 0, y un 0 es
    // "envío sin cargo siempre" para todos los comercios de esa lista.
    const p = parseEnvioMin(v);
    if (!p.ok || p.valor === null) {
      return json({ error: 'Escribí el monto en pesos, sin decimales. Por ejemplo: 140000 o 140.000.' }, 400);
    }
    filas.push({ key: k, value: String(p.valor) });
  }

  if (!filas.length) return json({ error: 'No llegó ningún monto para guardar.' }, 400);

  const ok = await sbUpsert('teia_settings', filas);
  if (!ok) {
    // El motivo casi siempre es que la tabla todavía no existe. Se dice, porque el mensaje
    // genérico manda a buscar el problema a cualquier lado menos al que es.
    console.warn('[teia] no se pudo guardar teia_settings (¿falta la tabla? supabase/2026-08-05-envios-remito-fotos.sql)');
    return json({ error: 'No se pudo guardar. Probá de nuevo en un momento; si sigue, avisá a soporte (puede faltar una actualización de la base).' }, 500);
  }
  return json({ ok: true });
};
