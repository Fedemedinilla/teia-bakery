export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { env, supaConfigured } from '../../../lib/supabase';

const BUCKET = 'teia-productos';
const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: recibe la imagen como BASE64 en un JSON (NO multipart — Vercel bloquea el
// multipart/form-data con 403 vía WAF) y la sube a Supabase Storage con la service_role key.
// Devuelve la URL pública. El bucket `teia-productos` debe existir y ser público.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ error: 'Conectá Supabase para subir imágenes.' }, 503);
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  const contentType = String(body?.contentType || 'image/jpeg');
  const b64 = String(body?.data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) return json({ error: 'No llegó la imagen.' }, 400);
  if (!/^image\//.test(contentType)) return json({ error: 'El archivo debe ser una imagen.' }, 400);

  let bytes: Buffer;
  try { bytes = Buffer.from(b64, 'base64'); } catch { return json({ error: 'Imagen inválida.' }, 400); }
  if (bytes.length === 0) return json({ error: 'La imagen llegó vacía.' }, 400);
  if (bytes.length > 4 * 1024 * 1024) return json({ error: 'La imagen es muy pesada (máx ~4 MB).' }, 413);

  const url = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
  const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[upload] storage', r.status, detail);
      const hint = /bucket not found/i.test(detail) ? ' Falta crear el bucket teia-productos (corré el SQL del bucket).' : '';
      return json({ error: `Storage respondió ${r.status}.${hint}`, detail: detail.slice(0, 300) }, 502);
    }
    return json({ url: `${url}/storage/v1/object/public/${BUCKET}/${path}` });
  } catch (e: any) {
    console.error('[upload] exception', e && e.message);
    return json({ error: 'Error al subir: ' + ((e && e.message) || 'desconocido') }, 500);
  }
};
