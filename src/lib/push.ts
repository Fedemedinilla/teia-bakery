// Notificaciones push al celular de Teia cuando entra un pedido.
//
// Va en paralelo al aviso por mail (lib/aviso.ts), con el MISMO criterio: es best-effort y no
// puede voltear ni demorar un pedido. Si falta configuración, si no hay teléfonos suscriptos o
// si el envío falla, el pedido se guarda igual y nadie se entera.
//
// Solo funciona sobre la app INSTALADA (PWA): en iPhone las notificaciones web existen
// únicamente para las apps agregadas a la pantalla de inicio; en Android es más flexible pero
// instalada anda mejor. El permiso lo da la administradora una vez, desde el panel.
//
// La criptografía (firma VAPID + cifrado del contenido) la hace `web-push`: es un estándar con
// varios pasos donde un error es invisible hasta que el aviso simplemente no llega.
import webpush from 'web-push';
import { env, sbSelect, sbDelete } from './supabase';

const TIMEOUT_MS = 6000;

export function pushConfigured(): boolean {
  return !!(env('TEIA_VAPID_PUBLIC_KEY') && env('TEIA_VAPID_PRIVATE_KEY'));
}

/** La clave pública viaja al navegador: no es secreta, la necesita para suscribirse. */
export function vapidPublicKey(): string {
  return env('TEIA_VAPID_PUBLIC_KEY') || '';
}

let configurado = false;
function configurar() {
  if (configurado) return;
  const contacto = (env('TEIA_ALERT_EMAIL') || '').split(',')[0].trim();
  webpush.setVapidDetails(
    contacto ? `mailto:${contacto}` : 'mailto:hello@kyndredai.com',
    env('TEIA_VAPID_PUBLIC_KEY') as string,
    env('TEIA_VAPID_PRIVATE_KEY') as string
  );
  configurado = true;
}

export type AvisoPush = {
  order_number: string;
  comercio: string;
  total: number | string;
  url: string;
};

/**
 * Manda el aviso a todos los teléfonos suscriptos. Nunca lanza.
 *
 * Si la tabla `teia_push_subs` todavía no existe, `sbSelect` devuelve [] (no distingue el error)
 * y esto no hace nada — a propósito: una feature apagada no puede tener requisitos de esquema
 * encendidos, que es justo lo que una vez dejó a todos sin poder entrar.
 */
async function enviarATodos(cuerpo: string): Promise<{ entregados: number; total: number }> {
  if (!pushConfigured()) return { entregados: 0, total: 0 };

  const subs = await sbSelect<any>('teia_push_subs?select=id,endpoint,p256dh,auth');
  if (!subs.length) return { entregados: 0, total: 0 };

  configurar();
  let entregados = 0;

  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await Promise.race([
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            cuerpo,
            { TTL: 3600 } // si el teléfono está apagado, el aviso espera hasta 1 hora
          ),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
        ]);
        entregados++;
      } catch (e: any) {
        // 404/410 = la suscripción murió (borró la app, reinstaló, revocó el permiso).
        // Se limpia sola para no reintentar contra un teléfono que ya no existe.
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await sbDelete(`teia_push_subs?id=eq.${Number(s.id)}`).catch(() => {});
        }
      }
    })
  );

  return { entregados, total: subs.length };
}

export async function avisarPushPedido(d: AvisoPush): Promise<void> {
  try {
    const monto = '$' + Number(d.total || 0).toLocaleString('es-AR');
    await enviarATodos(
      JSON.stringify({
        titulo: `Nuevo pedido — ${d.order_number}`,
        cuerpo: `${d.comercio} · ${monto}`,
        url: d.url,
        tag: d.order_number, // un aviso por pedido: reenviar el mismo reemplaza, no duplica
      })
    );
  } catch {
    // El pedido del cliente es sagrado: pase lo que pase acá, ya está guardado.
  }
}

/**
 * Aviso de prueba, disparado a mano desde el panel. A diferencia del de un pedido, acá SÍ
 * interesa el resultado: quien aprieta el botón quiere saber si llegó o no. Devuelve cuántos
 * teléfonos lo recibieron para poder decirlo en pantalla.
 */
export async function probarPush(): Promise<{ entregados: number; total: number }> {
  try {
    return await enviarATodos(
      JSON.stringify({
        titulo: 'Prueba de aviso',
        cuerpo: 'Si ves esto, los avisos de pedidos funcionan en este teléfono.',
        url: '/administradora#pedidos',
        tag: 'prueba',
      })
    );
  } catch {
    return { entregados: 0, total: 0 };
  }
}
