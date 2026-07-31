// Entrada al panel /administradora.
//
// ⚠️ POR QUÉ NO ES HTTP BASIC: el panel se instala como app en el celular, y **iOS no muestra el
// cartel de usuario/contraseña dentro de una app de la pantalla de inicio**. Mica cerraba la app,
// la volvía a abrir y se quedaba mirando "Autenticación requerida" sin forma de escribir la clave.
// El servidor hacía todo bien; el que no puede preguntar es el sistema operativo.
//
// Ahora el panel tiene su propia pantalla de ingreso —igual que la de los comercios— y una cookie
// firmada. Eso funciona en cualquier lado: navegador, app instalada, Android, iPhone.
//
// La clave sigue siendo `TEIA_ADMIN_PASSWORD` y se compara en tiempo constante. Basic Auth se
// sigue ACEPTANDO (para curl, scripts y el cron), pero ya NUNCA se pide con un desafío: sin
// desafío, iOS no tiene nada que mostrar y el problema desaparece.
import crypto from 'node:crypto';
import { env } from './supabase';
import { secret, isSecureRequest } from './session';

export const ADMIN_COOKIE = 'teia_admin';
// 30 días, y se renueva en cada visita al panel. Mica entra todos los días: que no le pida la
// clave cada vez. Si alguna vez hay que cerrar todas las sesiones, se rota TEIA_SESSION_SECRET.
export const ADMIN_MAX_AGE = 60 * 60 * 24 * 30;

function firmar(payload: string): string {
  return crypto.createHmac('sha256', secret()).update('admin:' + payload).digest('hex').slice(0, 32);
}

/** ¿La clave que escribió la persona es la del panel? Comparación en tiempo constante. */
export function adminPasswordOk(clave: unknown): boolean {
  const esperada = env('TEIA_ADMIN_PASSWORD');
  if (!esperada) return false;
  const a = Buffer.from(String(clave ?? ''), 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Valor de la cookie: cuándo se emitió + su firma. */
export function makeAdminSession(): string {
  const emitida = String(Date.now());
  return `${emitida}.${firmar(emitida)}`;
}

/** ¿La cookie es nuestra y sigue vigente? */
export function readAdminSession(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const i = raw.lastIndexOf('.');
  if (i < 1) return false;
  const payload = raw.slice(0, i);
  const dada = Buffer.from(raw.slice(i + 1));
  const esperada = Buffer.from(firmar(payload));
  if (dada.length !== esperada.length || !crypto.timingSafeEqual(dada, esperada)) return false;
  // La vigencia se valida también acá y no solo con el Max-Age de la cookie: el navegador puede
  // mentir sobre cuándo expira, el servidor no.
  const emitida = Number(payload);
  if (!Number.isFinite(emitida)) return false;
  return Date.now() - emitida < ADMIN_MAX_AGE * 1000;
}

function cookieHeader(valor: string, secure: boolean, maxAge: number): string {
  return [
    `${ADMIN_COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax', // Lax y no Strict: el link al remito desde la planilla de Google tiene que entrar
    secure ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export function setAdminCookie(request: Request): string {
  return cookieHeader(makeAdminSession(), isSecureRequest(request), ADMIN_MAX_AGE);
}

export function clearAdminCookie(request: Request): string {
  return cookieHeader('', isSecureRequest(request), 0);
}

/** Basic Auth: se sigue ACEPTANDO (curl, scripts, cron), pero nunca se pide. */
export function basicAuthOk(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const provided = atob(h.slice(6)).split(':').slice(1).join(':');
    // atob devuelve la vista latin1 de los bytes UTF-8 que mandó el navegador: decodificar
    // como 'latin1' recupera esos bytes exactos. Con el default ('utf8') una clave con
    // ñ/acentos se re-codificaba distinto y NUNCA validaba (lockout del panel).
    const a = Buffer.from(provided, 'latin1');
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function leerCookie(request: Request, nombre: string): string | undefined {
  const crudo = request.headers.get('cookie') || '';
  for (const parte of crudo.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return undefined;
}

/** ¿Quien llama tiene acceso al panel? Cookie propia, o Basic (curl/cron). */
export function isTeiaAdmin(request: Request): boolean {
  if (readAdminSession(leerCookie(request, ADMIN_COOKIE))) return true;
  return basicAuthOk(request, env('TEIA_ADMIN_PASSWORD'));
}

/**
 * Para NAVEGACIONES sin sesión (abrir el panel, un remito, el flujo de Google): se manda a la
 * pantalla de ingreso en vez de devolver un 401 pelado.
 *
 * ⚠️ Ya NO se devuelve `WWW-Authenticate`. Ese header es justamente lo que iOS no puede atender
 * dentro de una app instalada: mostraba el texto del 401 y dejaba a Mica sin poder entrar.
 */
export function redirigirAlIngreso(destino?: string): Response {
  const volver = destino ? `?volver=${encodeURIComponent(destino)}` : '';
  return new Response(null, {
    status: 302,
    headers: { Location: `/administradora/ingresar${volver}`, 'Cache-Control': 'no-store' },
  });
}
