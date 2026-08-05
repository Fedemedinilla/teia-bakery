export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch, sbDelete, supaConfigured } from '../../../lib/supabase';
import { isValidCuit, hasCuitShape, normCuit } from '../../../lib/cuit';
import { isCatalog } from '../../../lib/catalogs';
import { normCode, CODE_MIN } from '../../../lib/accesscode';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: gestionar las cuentas de clientes (pestaña "Clientes" del panel).
// Crear (sin id), editar (con id — incluye el descuento fiel del cliente) o borrar
// (action='delete'; los pedidos sobreviven: la FK pone client_id en null).
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

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
  // La LISTA a la que pertenece la cuenta (qué catálogo ve) y si puede entrar.
  if ('catalog' in b) {
    if (!isCatalog(b.catalog)) return json({ error: 'Catálogo inválido.' }, 400);
    patch.catalog = b.catalog;
  }
  if ('active' in b) patch.active = b.active !== false;

  // Contraseña del cliente. La escribe la administradora a mano, como el resto de los campos.
  // Se guarda TAL CUAL la escribió (solo sin espacios sobrantes): así el mensaje que le manda al
  // comercio dice exactamente lo mismo que ella ve en la ficha. Al entrar se compara ignorando
  // mayúsculas, espacios, símbolos y acentos (ver normCode), así que el comercio no falla por un
  // detalle de escritura. Vacío = la cuenta queda sin contraseña.
  if ('access_code' in b) {
    const escrita = String(b.access_code ?? '').trim().slice(0, 80);
    if (!escrita) patch.access_code = null;
    else if (normCode(escrita).length < CODE_MIN) {
      return json({ error: `La contraseña necesita al menos ${CODE_MIN} letras o números.` }, 400);
    } else patch.access_code = escrita;
  }
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
    if (ok) return json({ ok: true, warning });
    // El motivo casi siempre es un CUIT repetido, pero si la base no tiene todavía la columna
    // access_code (el SQL del 2º factor sin correr) el error es el mismo y el cartel mandaba a
    // buscar donde no era. Se nombran las dos causas cuando la contraseña viene en el pedido.
    return json({
      error: 'access_code' in patch
        ? 'No se pudo guardar. Puede ser que ese CUIT ya esté en otra cuenta, o que a la base le falte la columna de contraseñas (hay que correr supabase/schema.sql).'
        : 'No se pudo guardar (¿el CUIT ya existe en otra cuenta?).',
    }, 409);
  }

  if (!patch.cuit) return json({ error: 'Falta el CUIT de la cuenta nueva.' }, 400);
  if (!patch.business_name) return json({ error: 'Falta el nombre del comercio.' }, 400);
  let created = await sbInsert('teia_clients', patch);
  if (!created && 'access_code' in patch) {
    // Reintento sin la contraseña: la base todavía puede no tener la columna (el SQL es
    // opcional mientras el 2º factor esté apagado). Dar de alta un cliente nunca puede
    // fallar por una función que ni siquiera está activa.
    const { access_code, ...sinCodigo } = patch;
    created = await sbInsert('teia_clients', sinCodigo);
    // ⚠️ Pero se AVISA. Antes devolvía ok a secas: la cuenta se creaba, la contraseña se perdía
    // en silencio y el comercio recibía por WhatsApp una clave que no existía en ningún lado.
    if (created) {
      return json({
        ok: true,
        warning: 'La cuenta se creó, pero la CONTRASEÑA no se guardó: a la base le falta la columna. Corré supabase/schema.sql y volvé a escribirla.',
      });
    }
  }
  return created ? json({ ok: true, warning }) : json({ error: 'No se pudo crear (¿ya existe una cuenta con ese CUIT?).' }, 409);
};
