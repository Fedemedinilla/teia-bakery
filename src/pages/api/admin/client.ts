export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatchDetalle, sbDelete, sbSelect, sbSelectStrict, supaConfigured } from '../../../lib/supabase';
import { isValidCuit, hasCuitShape, normCuit } from '../../../lib/cuit';
import { isCatalog, catalogOf, attrSafe } from '../../../lib/catalogs';
import { normCode, CODE_MIN } from '../../../lib/accesscode';
import { parseEnvioMin } from '../../../lib/envio';
import { PANEL_VIEJO, esPanelNuevo } from '../../../lib/panel';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Los campos de la ficha que el panel puede mandar con su valor "esperado" (el envío propio va
// aparte: su columna puede no existir todavía, y no entra en una lectura estricta).
const CAMPOS_FICHA = ['business_name', 'client_contact', 'delivery_address', 'notes', 'cuit', 'catalog', 'active', 'access_code'];
const NOMBRE_CAMPO: Record<string, string> = {
  business_name: 'el nombre', client_contact: 'el contacto', delivery_address: 'la dirección', notes: 'las notas',
  cuit: 'el CUIT', catalog: 'la lista', active: 'el estado', access_code: 'la contraseña',
  envio_min: 'el envío sin cargo',
};
// ¿Lo que hay en la base es lo que la pantalla mostraba? La pantalla muestra los textos pasados por
// attrSafe (comillas → espacios) y el CUIT con guiones: se compara con el mismo tratamiento.
// attrSafe va a LOS DOS LADOS: después de un guardado sin recargar (el botón de WhatsApp), lo que la
// pantalla "muestra" es lo que viajó, crudo ("D'Angelo26"), y la base lo tiene crudo también. Con
// attrSafe de un solo lado, mandar la contraseña dos veces daba "esta pantalla está vieja" sin que
// nadie la hubiera cambiado (verificación del 19/9).
function igualEnFicha(campo: string, enBase: unknown, mostrado: unknown): boolean {
  if (campo === 'cuit') return normCuit(String(enBase ?? '')) === normCuit(String(mostrado ?? ''));
  if (campo === 'active') return (enBase !== false) === (mostrado === true || mostrado === '1' || mostrado === 'true');
  if (campo === 'catalog') return catalogOf(enBase) === String(mostrado ?? '');
  return attrSafe(enBase).trim() === attrSafe(mostrado).trim();
}

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
  // EDITAR una cuenta, solo desde el panel nuevo. El de antes del deploy manda la ficha ENTERA con lo
  // que su pantalla mostraba, y desde una pantalla vieja devolvía la lista, el estado o la contraseña
  // que se habían cambiado desde el otro dispositivo (lib/panel.ts). Dar de alta y borrar no pisan
  // nada, así que siguen andando sin la marca.
  if (id && !esPanelNuevo(b)) return json({ error: PANEL_VIEJO }, 409);
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
  // Los avisos se juntan: una misma edición puede traer más de uno (CUIT que no verifica + envío 0).
  // El del envío va aparte porque solo vale si el envío efectivamente se guardó.
  const avisos: string[] = [];
  let avisoEnvio: string | undefined;

  // Envío sin cargo PROPIO de este comercio (vacío = el de su lista). Existe por Chungo Pilar.
  // El panel lo manda SOLO si ella tocó el campo: así, si todavía no se corrió el SQL de la
  // columna, el resto de las ediciones de la ficha (nombre, contraseña, WhatsApp) siguen andando.
  if ('envio_min' in b) {
    const p = parseEnvioMin(b.envio_min);
    if (!p.ok) {
      return json({ error: 'El envío sin cargo tiene que ser un monto en pesos, sin decimales. Por ejemplo: 250000 o 250.000. Vacío = el de su lista.' }, 400);
    }
    patch.envio_min = p.valor;
    // El 0 es válido pero es plata: significa que ese comercio NUNCA paga el envío. Se confirma en
    // voz alta porque es fácil escribirlo pensando "ninguno", y "ninguno" es dejar el campo vacío.
    if (p.valor === 0) avisoEnvio = 'Ojo: con 0, este comercio NUNCA paga el envío. Si querías que use el monto de su lista, dejá el campo vacío.';
  }

  // El CUIT solo necesita FORMA (11 dígitos). Si no pasa el verificador de AFIP se AVISA pero
  // se guarda igual: Teia sabe quiénes son sus clientes mejor que el algoritmo, y bloquearla
  // por un dígito le impediría dar de alta a un cliente real.
  if ('cuit' in b) {
    const c = normCuit(b.cuit);
    if (!hasCuitShape(c)) return json({ error: 'El CUIT tiene que tener 11 números.' }, 400);
    if (!isValidCuit(c)) avisos.push('Guardado. Ojo: ese CUIT no pasa el verificador de AFIP — revisá que esté bien copiado.');
    patch.cuit = c;
  }
  const aviso = (...extra: (string | undefined)[]) => {
    const todos = [...avisos, ...extra].filter(Boolean);
    return todos.length ? todos.join('\n\n') : undefined;
  };

  if (id) {
    // El panel manda solo lo cambiado: una edición sin campos no tiene nada que escribir (y un PATCH
    // vacío no se le manda a la base).
    if (!Object.keys(patch).length) return json({ ok: true, warning: aviso() });

    // La cuenta como está AHORA: ¿existe, y la pantalla la mostraba así? (auditoría del 19/9)
    //  · Si otro dispositivo la borró, antes el PATCH no tocaba ninguna fila y el panel decía
    //    "guardado" (y el botón de WhatsApp le mandaba credenciales de una cuenta que no existe).
    //  · `esperado` = lo que la pantalla mostraba de cada campo que manda. Si la base ya tiene otra
    //    cosa, alguien lo cambió desde otro lado: se corta en vez de pisarlo. Es lo que hace el botón
    //    de WhatsApp seguro: manda la contraseña y el CUIT que muestra, pero solo si siguen siendo esos.
    const esperado = (b?.esperado && typeof b.esperado === 'object') ? b.esperado : {};
    const aComparar = CAMPOS_FICHA.filter((k) => k in esperado);
    // Columnas FIJAS y escritas a mano (no armadas con los campos que vinieron): así el guardián de la
    // "trampa de julio" de test-envio puede leerla, y envio_min no puede colarse nunca en esta lectura
    // estricta. Todas existen en producción.
    const actual = await sbSelectStrict(`teia_clients?id=eq.${id}&select=id,business_name,client_contact,delivery_address,notes,cuit,catalog,active,access_code`);
    if (actual === null) return json({ error: 'No se pudo leer la cuenta. No se guardó nada: probá de nuevo en un momento.' }, 503);
    if (!(actual as any[]).length) return json({ recargar: true, error: 'Esta cuenta ya no existe (se borró desde otro lado). No se guardó nada: recargá la página.' }, 404);
    const fila = (actual as any[])[0];
    const cambiados = aComparar.filter((k) => !igualEnFicha(k, fila[k], esperado[k]));
    // El envío propio, con su propia lectura y NO estricta: la columna puede no existir todavía (el
    // SQL del 18/9), y una lectura estricta de una columna que falta es la caída de julio. Si no se
    // puede leer, no se compara: el PATCH de abajo ya sabe qué hacer sin la columna.
    if ('envio_min' in patch && 'envio_min' in esperado) {
      const env = await sbSelect(`teia_clients?id=eq.${id}&select=envio_min`);
      const mostrado = parseEnvioMin(esperado.envio_min);
      if (env.length && mostrado.ok) {
        const enBase = env[0].envio_min;
        const valorBase = enBase === null || enBase === undefined || enBase === '' ? null : Number(enBase);
        if (valorBase !== mostrado.valor) cambiados.push('envio_min');
      }
    }
    if (cambiados.length) {
      const nombres = cambiados.map((k) => NOMBRE_CAMPO[k]).join(', ');
      return json({
        recargar: true,
        error: `Esta pantalla está vieja: ${nombres} de esta cuenta ya no ${cambiados.length > 1 ? 'son' : 'es'} lo que mostraba (¿se cambió desde el celular u otra pestaña?). No se guardó nada: recargá la página y volvé a hacer el cambio.`,
      }, 409);
    }
    let r = await sbPatchDetalle(`teia_clients?id=eq.${id}`, patch);

    // A la base le falta la columna del envío (el SQL del 18/9 sin correr). PostgREST lo dice con
    // el código PGRST204, y SOLO ante ese código se reintenta sin el campo: así lo demás de la
    // ficha se guarda, y ella sabe exactamente qué quedó afuera. Un reintento "por las dudas" ante
    // cualquier error confundiría un CUIT repetido con una columna que falta, y avisaría mal.
    if (!r.ok && r.code === 'PGRST204' && 'envio_min' in patch) {
      const { envio_min, ...sinEnvio } = patch;
      r = await sbPatchDetalle(`teia_clients?id=eq.${id}`, sinEnvio);
      if (r.ok) {
        console.warn('[teia] falta la columna teia_clients.envio_min: correr supabase/2026-09-18-envio-por-comercio.sql');
        return json({
          ok: true,
          // Lo lee Mica: nada de rutas de archivos. El detalle técnico va al log.
          warning: aviso('Se guardó todo MENOS el envío sin cargo: a la base le falta una actualización. Avisá a soporte y volvé a cargarlo cuando esté.'),
        });
      }
    }
    if (r.ok) return json({ ok: true, warning: aviso(avisoEnvio) });

    // Cada causa con su mensaje. Antes todas decían "¿el CUIT ya existe?", y cuando la causa era
    // otra el cartel mandaba a buscar donde no era.
    if (r.code === '23505') return json({ error: 'No se pudo guardar: ese CUIT ya está en otra cuenta.' }, 409);
    if (r.code === 'PGRST204') {
      console.warn('[teia] PGRST204 al guardar una cuenta: falta una columna, correr los SQL pendientes de supabase/');
      return json({ error: 'No se pudo guardar: a la base le falta una actualización. Avisá a soporte.' }, 409);
    }
    if (r.status === 0 || r.status >= 500) {
      return json({ error: 'No se pudo guardar: la base no respondió. Probá de nuevo en un momento.' }, 503);
    }
    return json({ error: 'No se pudo guardar la cuenta. Revisá los datos y probá de nuevo.' }, 409);
  }

  if (!patch.cuit) return json({ error: 'Falta el CUIT de la cuenta nueva.' }, 400);
  if (!patch.business_name) return json({ error: 'Falta el nombre del comercio.' }, 400);
  // El alta NO lleva envío propio: el formulario de alta no lo tiene, y una cuenta nueva usa el de
  // su lista. Se descarta si vino igual (una llamada directa a la API) para que el alta quede
  // idéntica a la de siempre y nunca pueda fallar por la columna nueva.
  delete patch.envio_min;
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
        warning: 'La cuenta se creó, pero la CONTRASEÑA no se guardó: a la base le falta una actualización. Avisá a soporte y volvé a escribirla cuando esté.',
      });
    }
  }
  return created ? json({ ok: true, warning: aviso() }) : json({ error: 'No se pudo crear (¿ya existe una cuenta con ese CUIT?).' }, 409);
};
