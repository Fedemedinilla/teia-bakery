export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch, sbDelete, supaConfigured } from '../../../lib/supabase';
import { isValidCuit, hasCuitShape, normCuit } from '../../../lib/cuit';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: gestionar las cuentas de clientes (pestaña "Clientes" del panel).
// Crear (sin id), editar (con id — incluye el descuento fiel del cliente) o borrar
// (action='delete'; los pedidos sobreviven: la FK pone client_id en null).
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true });
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  if (b?.action === 'delete') {
    const id = Number(b?.id);
    if (!id) return json({ error: 'id inválido.' }, 400);
    const ok = await sbDelete(`teia_clients?id=eq.${id}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo borrar la cuenta.' }, 500);
  }

  const id = Number(b?.id) || null;
  const patch: Record<string, any> = {};

  if ('business_name' in b) {
    const v = String(b.business_name ?? '').slice(0, 160).trim();
    if (!v) return json({ error: 'Falta el nombre del comercio.' }, 400);
    patch.business_name = v;
  }
  if ('client_contact' in b) patch.client_contact = String(b.client_contact ?? '').slice(0, 160).trim();
  if ('delivery_address' in b) patch.delivery_address = String(b.delivery_address ?? '').slice(0, 300).trim();
  if ('notes' in b) patch.notes = String(b.notes ?? '').slice(0, 500).trim();
  if ('discount_pct' in b) {
    patch.discount_pct = [0, 10].includes(Number(b.discount_pct)) ? Number(b.discount_pct) : 0;
  }
  // El CUIT solo necesita FORMA (11 dígitos). Si no pasa el verificador de AFIP se AVISA pero
  // se guarda igual: Teia sabe quiénes son sus clientes mejor que el algoritmo, y bloquearla
  // por un dígito le impediría dar de alta a un cliente real.
  let warning: string | undefined;
  if ('cuit' in b) {
    const c = normCuit(b.cuit);
    if (!hasCuitShape(c)) return json({ error: 'El CUIT tiene que tener 11 números.' }, 400);
    if (!isValidCuit(c)) warning = 'Guardado. Ojo: ese CUIT no pasa el verificador de AFIP — revisá que esté bien copiado.';
    patch.cuit = c;
  }

  if (id) {
    const ok = await sbPatch(`teia_clients?id=eq.${id}`, patch);
    return ok ? json({ ok: true, warning }) : json({ error: 'No se pudo guardar (¿el CUIT ya existe en otra cuenta?).' }, 409);
  }

  if (!patch.cuit) return json({ error: 'Falta el CUIT de la cuenta nueva.' }, 400);
  if (!patch.business_name) return json({ error: 'Falta el nombre del comercio.' }, 400);
  const created = await sbInsert('teia_clients', patch);
  return created ? json({ ok: true, warning }) : json({ error: 'No se pudo crear (¿ya existe una cuenta con ese CUIT?).' }, 409);
};
