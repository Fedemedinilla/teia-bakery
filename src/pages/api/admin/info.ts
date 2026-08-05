export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch, sbDelete, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: la información que ve el cliente (medios de pago, envíos, duración).
// Crear (default) · editar (viene id) · borrar (action='delete').
//
// El texto lo escribe la administradora y lo LEE un cliente, así que se limpian `< > " '` al
// guardar además de escapar al mostrar: misma defensa en profundidad que en el resto del panel
// (ver el comentario de attrSafe en lib/catalogs.ts).
const limpiar = (v: any, max: number) =>
  String(v ?? '').replace(/[<>"']/g, ' ').slice(0, max).trim();

export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: no persiste

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  if (b?.action === 'delete') {
    const id = Number(b?.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'id inválido.' }, 400);
    const ok = await sbDelete(`teia_info?id=eq.${id}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo eliminar.' }, 500);
  }

  const pregunta = limpiar(b?.pregunta, 120);
  const respuesta = limpiar(b?.respuesta, 600);
  if (!pregunta) return json({ error: 'Falta el título.' }, 400);
  if (!respuesta) return json({ error: 'Falta el texto.' }, 400);

  const fila = { pregunta, respuesta, sort_order: parseInt(b?.sort_order) || 0 };

  if (b?.id) {
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'id inválido.' }, 400);
    const ok = await sbPatch(`teia_info?id=eq.${id}`, fila);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo guardar.' }, 500);
  }

  const creada = await sbInsert('teia_info', fila);
  return creada ? json({ ok: true }) : json({ error: 'No se pudo guardar.' }, 500);
};
