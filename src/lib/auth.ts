// Admin gate for /administradora — timing-safe HTTP Basic Auth (the storefront is public;
// only the panel needs a password). Same pattern as the KyndredAI chatbot admin.
import crypto from 'node:crypto';
import { env } from './supabase';

export function basicAuthOk(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const provided = atob(h.slice(6)).split(':').slice(1).join(':');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// True if the request carries the right panel password (TEIA_ADMIN_PASSWORD).
export function isTeiaAdmin(request: Request): boolean {
  return basicAuthOk(request, env('TEIA_ADMIN_PASSWORD'));
}

// 401 + Basic challenge → the browser shows its login prompt and caches the credentials
// so later same-origin fetches (confirmar, guardar producto) carry them automatically.
export function authChallenge(): Response {
  return new Response('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Teia Administradora", charset="UTF-8"' },
  });
}
