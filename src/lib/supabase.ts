// Supabase REST helper (service_role, server-only). No SDK, no secrets in the repo — the
// credentials live only in Vercel env. Every helper degrades gracefully (returns empty/false)
// when Supabase isn't configured yet, so the app builds and runs before the project exists.

export function env(name: string): string | undefined {
  const proc = (globalThis as any).process;
  return (proc?.env?.[name] as string | undefined) ?? ((import.meta as any).env?.[name] as string | undefined);
}

export function supaConfigured(): boolean {
  return Boolean(env('SUPABASE_URL') && env('SUPABASE_SERVICE_ROLE_KEY'));
}

function base(): string {
  return (env('SUPABASE_URL') || '').replace(/\/+$/, '');
}
function key(): string {
  return env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

export function sb(path: string): string {
  return `${base()}/rest/v1/${path}`;
}
export function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...extra };
}

// SELECT — returns rows, or [] on any failure (storefront keeps working).
export async function sbSelect<T = any>(path: string): Promise<T[]> {
  if (!supaConfigured()) return [];
  try {
    const r = await fetch(sb(path), { headers: sbHeaders() });
    if (!r.ok) return [];
    return (await r.json()) as T[];
  } catch {
    return [];
  }
}

// INSERT — returns the created row(s) (return=representation), or null on failure.
export async function sbInsert<T = any>(table: string, body: unknown): Promise<T[] | null> {
  if (!supaConfigured()) return null;
  try {
    const r = await fetch(sb(table), {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

// PATCH — returns true on success.
export async function sbPatch(path: string, body: unknown): Promise<boolean> {
  if (!supaConfigured()) return false;
  try {
    const r = await fetch(sb(path), {
      method: 'PATCH',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// DELETE — returns true on success.
export async function sbDelete(path: string): Promise<boolean> {
  if (!supaConfigured()) return false;
  try {
    const r = await fetch(sb(path), { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=minimal' }) });
    return r.ok;
  } catch {
    return false;
  }
}

// UPLOAD a Storage — sube bytes a un bucket y devuelve la URL pública, o null si falla.
// x-upsert:true → idempotente: reintentar con el mismo path sobreescribe, no duplica.
export async function sbUpload(bucket: string, path: string, bytes: Uint8Array | Buffer, contentType: string): Promise<string | null> {
  if (!supaConfigured()) return null;
  const url = base(), k = key();
  try {
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes as any,
    });
    return r.ok ? `${url}/storage/v1/object/public/${bucket}/${path}` : null;
  } catch {
    return null;
  }
}
