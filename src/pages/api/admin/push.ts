export const prerender = false;
import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbDelete, sbSelectStrict, supaConfigured, env } from '../../../lib/supabase';
import { probarPush } from '../../../lib/push';
import { avisoConfigurado, destinatarios } from '../../../lib/aviso';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** De qué aparato es una suscripción, deducido del host. Solo para el diagnóstico: el endpoint
 *  entero nunca sale de acá porque es la llave para mandarle notificaciones a ese teléfono. */
function servicioDe(endpoint: string): string {
  let host = '';
  try { host = new URL(String(endpoint)).host; } catch { return 'desconocido'; }
  if (/apple\.com$/.test(host)) return 'iPhone o iPad (Safari)';
  if (/windows\.com$/.test(host)) return 'Windows (Edge)';
  if (/(googleapis|google)\.com$/.test(host)) return 'Android o Chrome';
  if (/mozilla\.com$/.test(host)) return 'Firefox';
  return host;
}

// Diagnóstico de la configuración de avisos. Es de solo lectura y NUNCA devuelve la clave
// privada: solo dice si está y si se corresponde con la pública.
//
// Existe por un modo de falla silencioso: si las dos claves no son del MISMO par (por ejemplo
// pegar la pública de una corrida y la privada de otra), no falla nada hasta que el aviso
// simplemente no llega. Acá se comprueba derivando la pública desde la privada.
export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  const pub = (env('TEIA_VAPID_PUBLIC_KEY') || '').trim();
  const priv = (env('TEIA_VAPID_PRIVATE_KEY') || '').trim();

  // La pública es un punto P-256 sin comprimir: 65 bytes que arrancan con 0x04.
  let pubBytes = 0, pubFormato = false;
  try {
    const b = Buffer.from(pub, 'base64url');
    pubBytes = b.length;
    pubFormato = b.length === 65 && b[0] === 0x04;
  } catch { /* queda en false */ }

  // ¿La privada corresponde a esa pública? Se deriva y se comparan.
  let parCoincide = false;
  try {
    if (pubFormato && priv) {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
      const derivada = ecdh.getPublicKey();
      const declarada = Buffer.from(pub, 'base64url');
      parCoincide = derivada.length === declarada.length && crypto.timingSafeEqual(derivada, declarada);
    }
  } catch { /* claves inválidas: queda en false */ }

  // ¿Existe la tabla? sbSelectStrict distingue "falló" (null) de "no hay filas" ([]).
  let tabla: boolean | null = null;
  let suscripciones: number | null = null;
  // Qué aparatos están dados de alta. NUNCA el endpoint completo: lleva el token que permite
  // mandarle avisos a ese aparato. Solo el servicio, que se deduce del host, y la fecha de alta.
  // Sirve para el caso concreto de "llegó una vez y nunca más": se ve de una CUÁL de los dos
  // aparatos desapareció, sin tener que adivinar.
  let dispositivos: any[] = [];
  if (supaConfigured()) {
    const filas = await sbSelectStrict<any>('teia_push_subs?select=id,endpoint,created_at&order=created_at.asc');
    tabla = filas !== null;
    suscripciones = filas === null ? null : filas.length;
    dispositivos = (filas || []).map((f: any) => ({ id: f.id, aparato: servicioDe(f.endpoint), alta: f.created_at }));
  }

  // Estado del OTRO canal de aviso (el mail). Va acá porque es el mismo diagnóstico operativo:
  // "¿me voy a enterar cuando entre un pedido?". `destinatarios()` descarta en silencio las
  // direcciones sin @, así que un typo en TEIA_ALERT_EMAIL deja el aviso mudo sin ningún error
  // — el mismo tipo de falla invisible que las claves cruzadas. Nunca devuelve las direcciones.
  const mail = {
    configurado: avisoConfigurado(),
    api_key_presente: !!env('RESEND_API_KEY'),
    destinatarios_validos: destinatarios().length,
  };

  const listo = pubFormato && parCoincide && tabla === true;
  return json({
    listo,
    mail,
    claves: {
      publica_presente: !!pub,
      publica_bytes: pubBytes,
      publica_formato_ok: pubFormato,
      privada_presente: !!priv,
      par_coincide: parCoincide,
    },
    base: { tabla_existe: tabla, telefonos_suscriptos: suscripciones, dispositivos },
    falta: [
      !pub || !priv ? 'cargar las dos env vars TEIA_VAPID_* en Vercel y redeployar' : null,
      pub && !pubFormato ? 'la clave pública no tiene el formato esperado: regenerar con npm run vapid' : null,
      pub && priv && pubFormato && !parCoincide ? 'las dos claves NO son del mismo par: regenerar con npm run vapid y pegar AMBAS' : null,
      // null (y no false) = Supabase no está configurado: sin base no hay dónde guardar los teléfonos.
      tabla === null ? 'configurar Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)' : null,
      tabla === false ? 'correr el SQL de teia_push_subs en Supabase' : null,
      listo && suscripciones === 0 ? 'que la administradora toque "Activar" desde la app instalada' : null,
      !mail.api_key_presente ? 'aviso por mail: falta RESEND_API_KEY en Vercel' : null,
      mail.api_key_presente && mail.destinatarios_validos === 0
        ? 'aviso por mail: TEIA_ALERT_EMAIL está vacía o mal escrita (ninguna dirección con @)'
        : null,
    ].filter(Boolean),
  });
};

// Guarda o borra la suscripción a notificaciones del teléfono de la administradora.
// El gate de admin va PRIMERO (antes de mirar la config), igual que en el resto de /api/admin/*:
// si no, un deploy sin Supabase dejaría el endpoint abierto.
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  // Aviso de prueba a los teléfonos ya suscriptos: sirve para verificar que todo funciona sin
  // tener que crear un pedido falso (que quedaría en el panel, en la planilla y en Drive).
  if (b?.action === 'prueba') {
    const r = await probarPush();
    return json({ ok: true, ...r });
  }

  const endpoint = String(b?.endpoint || '').trim();
  // El endpoint lo emite el navegador y siempre es https (Apple o Google según el teléfono).
  // El tope es 2000 y no 800: la columna es `text` (no tiene límite) y los canales de Windows son
  // largos. Con 800 un alta legítima de una PC podía ser rechazada con "suscripción inválida",
  // un mensaje que manda a buscar el problema donde no está.
  if (!endpoint || !endpoint.startsWith('https://') || endpoint.length > 2000) {
    return json({ error: 'suscripción inválida' }, 400);
  }

  if (b?.action === 'baja') {
    const ok = await sbDelete(`teia_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo desactivar.' }, 500);
  }

  const p256dh = String(b?.p256dh || '').trim();
  const auth = String(b?.auth || '').trim();
  if (!p256dh || !auth) return json({ error: 'suscripción incompleta' }, 400);

  // ── Alta IDEMPOTENTE ────────────────────────────────────────────────────────────────────
  // Si el aparato YA está dado de alta con las mismas claves, no se toca nada y listo.
  //
  // No es una optimización: es un requisito. El panel ahora re-registra el aparato en CADA carga
  // (ver ActivarAvisos.astro), porque el navegador puede decir "activados" mientras el servidor
  // perdió la fila. Con el borrar-y-volver-a-insertar de antes, cada apertura del panel abría una
  // ventana de milisegundos SIN suscripción — justo el rato en que podía entrar un pedido y no
  // avisarle a nadie. Y además rotaba el id y pisaba la fecha de alta, que es el dato con el que
  // se diagnostica todo esto.
  const ya = await sbSelectStrict<any>(
    `teia_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}&select=id,p256dh,auth`
  );
  if (ya !== null && ya[0] && ya[0].p256dh === p256dh && ya[0].auth === auth) {
    return json({ ok: true, sin_cambios: true });
  }

  // Cambió algo (claves nuevas tras una rotación) o no estaba: se reemplaza.
  await sbDelete(`teia_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`);

  const fila = await sbInsert('teia_push_subs', { endpoint, p256dh, auth });
  if (!fila) return json({ error: 'No se pudo activar. ¿Corriste el SQL de teia_push_subs?' }, 500);
  return json({ ok: true });
};
