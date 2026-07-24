export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, supaConfigured } from '../../lib/supabase';
import { hasCuitShape, normCuit } from '../../lib/cuit';
import { DEMO_CLIENTS } from '../../lib/demo';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Público: identifica al comercio por su CUIT y devuelve sus datos para autocompletar el
// checkout. El CUIT tiene que estar dado de alta por Teia — si no existe, no se pide.
// Solo se exige la FORMA (11 dígitos): el filtro real es la lista de cuentas, no un algoritmo.
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const cuit = normCuit(b?.cuit);
  if (!hasCuitShape(cuit)) return json({ error: 'Ingresá tu CUIT (11 números).' }, 400);

  if (!supaConfigured()) {
    const c = DEMO_CLIENTS.find((x) => x.cuit === cuit);
    return c
      ? json({ ok: true, client: { business_name: c.business_name, client_contact: c.client_contact, delivery_address: c.delivery_address } })
      : json({ ok: true, unknown: true });
  }

  const rows = await sbSelectStrict(`teia_clients?cuit=eq.${cuit}&select=id,business_name,client_contact,delivery_address`);
  if (rows === null) return json({ error: 'No se pudo consultar. Probá de nuevo en un momento.' }, 503);
  const c = (rows as any[])[0];
  if (!c) return json({ ok: true, unknown: true }); // sin alta de Teia no hay pedido

  return json({
    ok: true,
    client: {
      business_name: c.business_name,
      client_contact: c.client_contact,
      delivery_address: c.delivery_address,
    },
  });
};
