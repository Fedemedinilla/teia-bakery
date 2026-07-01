export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { env, supaConfigured } from '../../../lib/supabase';

const BUCKET = 'teia-productos';
const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: recibe un archivo (multipart) y lo sube a Supabase Storage con la service_role key
// (bypassa la RLS de storage). Devuelve la URL pública. El bucket `teia-productos` debe existir
// y ser público (ver supabase/schema.sql / el SQL del bucket).
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ error: 'Conectá Supabase para subir imágenes.' }, 503);
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'formulario inválido' }, 400); }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ error: 'No llegó ningún archivo.' }, 400);
  if (!/^image\//.test(file.type)) return json({ error: 'El archivo debe ser una imagen.' }, 400);
  if (file.size > 4 * 1024 * 1024) return json({ error: 'La imagen es muy pesada (máx ~4 MB). Probá otra.' }, 413);

  const url = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || '';
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': file.type, 'x-upsert': 'true' },
      body: await file.arrayBuffer(),
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
