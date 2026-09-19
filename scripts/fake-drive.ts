// Google Drive FALSO, en memoria, para probar `lib/google.ts` sin credenciales y sin tocar el
// Drive de nadie.
//
// Por qué existe: la app en producción escribe en el Drive REAL de la clienta. Probar el camino de
// Drive contra su cuenta no es una opción, y las credenciales de producción no están en esta
// máquina. Sin esto, el código de Drive solo se podría "verificar" leyéndolo — que es exactamente
// como se cuelan los bugs que este archivo existe para atrapar.
//
// Cómo funciona: `lib/google.ts` llama a `fetch` pelado, que resuelve a `globalThis.fetch`. Acá se
// reemplaza esa función por una que entiende el subconjunto de la API de Drive que usa la app.
// **No hace falta tocar una sola línea del código de producción** — que es el punto: el arnés no
// puede introducir el bug que busca.
//
// Modela de verdad las dos cosas que importan y que son la fuente de los bugs caros:
//   · `appProperties` como marca reencontrable (si la marca no se aplica, la búsqueda no encuentra
//     y el código crea una carpeta nueva CADA VEZ — el modo de falla que dejaría a la encargada
//     del local mirando una carpeta vieja y vacía).
//   · la semántica de `name = 'X' and 'PARENT' in parents`, que es como se evita duplicar carpetas.

type Archivo = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  bytes?: number;      // tamaño del contenido subido (no guardamos el PDF entero)
  escrituras: number;  // cuántas veces se subió/actualizó: delata duplicados y re-subidas
};

export type Llamada = { metodo: string; url: string; momento: number };

const CARPETA = 'application/vnd.google-apps.folder';

// Reloj monotono COMPARTIDO entre los dos fakes: sin esto no se puede afirmar que una
// escritura a Supabase ocurrio ANTES que una llamada a Drive, que es justo el invariante
// del que depende que un pedido nunca quede marcado sin archivar teniendo el remito.
let _tic = 0;
export const reloj = () => ++_tic;

export class FakeDrive {
  archivos = new Map<string, Archivo>();
  llamadas: Llamada[] = [];
  private n = 0;

  /** Planillas de Sheets: sus pestañas y lo que se escribió en cada una (filas × columnas). */
  planillas = new Map<string, { pestañas: { sheetId: number; title: string }[]; valores: Map<string, any[][]> }>();
  private planillaVacia(id: string) {
    const p = { pestañas: [{ sheetId: 0, title: 'Hoja 1' }], valores: new Map<string, any[][]>() };
    this.planillas.set(id, p);
    return p;
  }
  /** Las filas escritas en una pestaña de la (única) planilla, o undefined si nunca se escribió. */
  filasDe(pestaña: string): any[][] | undefined {
    for (const p of this.planillas.values()) if (p.valores.has(pestaña)) return p.valores.get(pestaña);
    return undefined;
  }

  /** Fallas inyectadas: la primera que matchee la URL dispara y se consume. */
  private fallas: { patron: RegExp; status: number; veces: number; disparos: number }[] = [];

  /** Hace fallar las próximas `veces` llamadas cuyo URL matchee `patron`. */
  fallar(patron: RegExp, status = 500, veces = 1) {
    this.fallas.push({ patron, status, veces, disparos: 0 });
  }

  /**
   * Cuántas fallas inyectadas dispararon de verdad. Existe porque un patrón que no matchea deja
   * la prueba en verde sin haber probado nada: pasó con /%27print%27/, que nunca matcheaba porque
   * encodeURIComponent NO codifica la comilla simple. Un test de fallos tiene que poder demostrar
   * que hubo un fallo.
   */
  fallasDisparadas(): number {
    return this.fallas.reduce((n, f) => n + f.disparos, 0);
  }

  /** Saca las fallas inyectadas. Va en el reset de cada caso: una falla con `veces` de sobra se
   *  filtra a los casos siguientes y los rompe con un motivo que no es el suyo. */
  limpiarFallas() {
    this.fallas.length = 0;
  }

  private id(): string {
    // Determinista a propósito: sin Math.random, dos corridas dan los mismos ids y los diffs sirven.
    this.n += 1;
    return `id${String(this.n).padStart(3, '0')}`;
  }

  /** Vista legible del árbol, para aserciones y para mirar con los ojos. */
  arbol(): string[] {
    const nombre = (a: Archivo): string => {
      const padre = a.parents[0] ? this.archivos.get(a.parents[0]) : undefined;
      return (padre ? nombre(padre) + '/' : '') + a.name;
    };
    return [...this.archivos.values()]
      .filter((a) => !a.trashed)
      .map((a) => `${nombre(a)}${a.mimeType === CARPETA ? '/' : ''}` +
        `${a.appProperties.teia_role ? `  [${a.appProperties.teia_role}]` : ''}` +
        `${a.escrituras > 1 ? `  (escrito ${a.escrituras}×)` : ''}`)
      .sort();
  }

  /** Manda un archivo a la papelera por nombre, como haría la clienta desde la UI de Drive. */
  aLaPapelera(nombre: string): boolean {
    const a = [...this.archivos.values()].find((x) => x.name === nombre && !x.trashed);
    if (!a) return false;
    a.trashed = true;
    // Drive marca la carpeta, no a sus hijos, pero los hijos DEJAN de verse. Modelarlo importa:
    // de acá sale la decisión de no restaurar automáticamente (restaurar resucita lo ya impreso).
    return true;
  }

  /** Los hijos vivos de una carpeta, como los ve una búsqueda `'<id>' in parents`. */
  hijos(padreId: string): Archivo[] {
    return [...this.archivos.values()].filter((a) => !a.trashed && a.parents.includes(padreId));
  }

  buscar(q: string): Archivo[] {
    let candidatos = [...this.archivos.values()];

    // Drive trata `trashed` como filtro explícito: si la query lo pide, se respeta el valor pedido.
    const basura = q.match(/trashed\s*=\s*(true|false)/);
    if (basura) candidatos = candidatos.filter((a) => a.trashed === (basura[1] === 'true'));

    // appProperties has { key='teia_role' and value='root' }
    const marca = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/);
    if (marca) candidatos = candidatos.filter((a) => a.appProperties[marca[1]] === marca[2]);

    // name = 'Julio'   (con \' escapado, como lo manda escQ)
    const nombre = q.match(/name = '((?:[^'\\]|\\.)*)'/);
    if (nombre) {
      const buscado = nombre[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      candidatos = candidatos.filter((a) => a.name === buscado);
    }

    // 'id007' in parents
    const padre = q.match(/'([^']+)' in parents/);
    if (padre) candidatos = candidatos.filter((a) => a.parents.includes(padre[1]));

    // mimeType = 'application/vnd.google-apps.folder'
    const mime = q.match(/mimeType = '([^']+)'/);
    if (mime) candidatos = candidatos.filter((a) => a.mimeType === mime[1]);

    return candidatos;
  }

  /** El `fetch` que reemplaza al global. */
  fetch = async (entrada: any, init: any = {}): Promise<Response> => {
    const url = String(entrada);
    const metodo = (init.method || 'GET').toUpperCase();
    this.llamadas.push({ metodo, url, momento: reloj() });

    const falla = this.fallas.find((f) => f.veces > 0 && f.patron.test(url));
    if (falla) {
      falla.veces -= 1;
      falla.disparos += 1;
      return new Response('falla inyectada', { status: falla.status });
    }

    const json = (o: unknown) =>
      new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // --- OAuth: refresh token -> access token ---
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'token-falso', expires_in: 3600 });
    }

    // --- Subida multipart: crea el archivo ---
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
      const cuerpo = String(init.body instanceof Uint8Array ? Buffer.from(init.body).toString('latin1') : init.body);
      const meta = JSON.parse(cuerpo.match(/\{[\s\S]*?\}(?=\r\n--)/)![0]);
      const id = this.id();
      this.archivos.set(id, {
        id, name: meta.name, mimeType: meta.mimeType || 'application/pdf',
        parents: meta.parents || [], appProperties: meta.appProperties || {},
        trashed: false, bytes: cuerpo.length, escrituras: 1,
      });
      return json({ id });
    }

    // --- Subida media: actualiza el contenido de uno que ya existe ---
    const media = url.match(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/([^?]+)\?uploadType=media/);
    if (media) {
      const a = this.archivos.get(media[1]);
      if (!a) return new Response('no existe', { status: 404 });
      a.escrituras += 1;
      a.bytes = (init.body as Uint8Array)?.length ?? a.bytes;
      return json({ id: a.id });
    }

    // --- Búsqueda ---
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      const params = new URL(url).searchParams;
      const q = decodeURIComponent(params.get('q') || '');
      let encontrados = this.buscar(q);
      // `orderBy=createdTime`: los ids son secuenciales por construcción, así que el orden de id
      // ES el orden de creación. Es lo que hace determinista "gana la carpeta más vieja".
      //
      // ⚠️ SIN orderBy se devuelve el orden INVERTIDO, a propósito. Drive no garantiza ningún
      // orden si no se lo pedís, y un fake que devolviera el orden de creación por casualidad
      // dejaría pasar en verde un código que se olvidó de pedir `orderBy` — que es justamente el
      // bug que arruinaría el invariante "gana siempre la carpeta que ella compartió".
      // Con esto, el test de "la más vieja" solo pasa si el código PIDE el orden.
      encontrados = [...encontrados].sort((a, b) => a.id.localeCompare(b.id));
      if (!(params.get('orderBy') || '').startsWith('createdTime')) encontrados.reverse();
      const tope = Number(params.get('pageSize')) || 100;
      return json({
        files: encontrados.slice(0, tope).map((a) => ({
          id: a.id, name: a.name,
          webViewLink: `https://drive.google.com/drive/folders/${a.id}`,
        })),
      });
    }

    // --- Crear carpeta (o archivo) por metadata ---
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && metodo === 'POST') {
      const meta = JSON.parse(String(init.body));
      const id = this.id();
      this.archivos.set(id, {
        id, name: meta.name, mimeType: meta.mimeType || 'application/octet-stream',
        parents: meta.parents || [], appProperties: meta.appProperties || {},
        trashed: false, escrituras: 1,
      });
      return json({ id, name: meta.name, webViewLink: `https://drive.google.com/drive/folders/${id}` });
    }

    // --- PATCH de metadata: mover de carpeta y/o marcar ---
    const patch = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?/);
    if (patch && metodo === 'PATCH') {
      const a = this.archivos.get(patch[1]);
      if (!a) return new Response('no existe', { status: 404 });
      const addParents = new URL(url).searchParams.get('addParents');
      if (addParents) a.parents = [addParents];
      if (init.body) {
        const meta = JSON.parse(String(init.body));
        if (meta.appProperties) a.appProperties = { ...a.appProperties, ...meta.appProperties };
        if (meta.name) a.name = meta.name;
        if (typeof meta.trashed === 'boolean') a.trashed = meta.trashed;
      }
      return json({ id: a.id });
    }

    // --- Sheets: un modelo mínimo (pestañas y valores) ---
    // Antes se aceptaba y se ignoraba todo, y el espejo reventaba en su segunda llamada: una prueba
    // del espejo daba "ok" sin que ninguna fila llegara al Sheet (auditoría del 19/9). Ahora se
    // guardan las pestañas que crea y lo que escribe en cada una, para poder contarlo.
    if (url.startsWith('https://sheets.googleapis.com/')) {
      const base = url.split('?')[0];
      if (/\/spreadsheets$/.test(base) && metodo === 'POST') {
        const id = this.id();
        this.archivos.set(id, {
          id, name: 'planilla', mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [], appProperties: {}, trashed: false, escrituras: 1,
        });
        this.planillas.set(id, { pestañas: [{ sheetId: 0, title: 'Hoja 1' }], valores: new Map() });
        return json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
      }
      const m = base.match(/\/spreadsheets\/([^/:]+)(?::batchUpdate|\/values\/([^:]+)(?::clear)?)?$/);
      const planilla = m && (this.planillas.get(m[1]) || this.planillaVacia(m[1]));
      if (!m || !planilla) throw new Error(`FakeDrive: no sé responder ${metodo} ${url}`);
      const pestañaDe = (rango: string) => decodeURIComponent(rango).replace(/^'|'!.*$/g, '').replace(/'$/, '');
      if (base.endsWith(':batchUpdate')) {
        const cuerpo = JSON.parse(String(init.body || '{}'));
        for (const r of cuerpo.requests || []) {
          if (r.addSheet) planilla.pestañas.push({ sheetId: planilla.pestañas.length + 100, title: r.addSheet.properties.title });
        }
        return json({});
      }
      if (m[2] && base.endsWith(':clear')) { planilla.valores.set(pestañaDe(m[2]), []); return json({}); }
      if (m[2] && metodo === 'PUT') {
        const rango = decodeURIComponent(m[2]);
        const valores = JSON.parse(String(init.body || '{}')).values || [];
        // Solo se guarda lo que se escribe desde A1 (la pestaña entera); los rangos parciales (los
        // links de los remitos en la columna L) no cambian la cantidad de filas.
        if (/!A1$/.test(rango)) planilla.valores.set(pestañaDe(m[2]), valores);
        return json({});
      }
      // GET de la metadata: las pestañas.
      return json({ sheets: planilla.pestañas.map((p) => ({ properties: p, bandedRanges: [] })) });
    }

    throw new Error(`FakeDrive: no sé responder ${metodo} ${url}`);
  };
}

/**
 * Instala el Drive falso y las env vars que `gConfigured()` necesita. Devuelve el drive y una
 * función para desinstalar todo. El `fetch` real se guarda y se restaura.
 */
export function instalarFakeDrive(): { drive: FakeDrive; desinstalar: () => void } {
  const drive = new FakeDrive();
  const fetchReal = globalThis.fetch;
  const antes: Record<string, string | undefined> = {};
  const vars = {
    GOOGLE_OAUTH_CLIENT_ID: 'cliente-falso',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-falso',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-falso',
  };
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  globalThis.fetch = drive.fetch as typeof fetch;

  return {
    drive,
    desinstalar() {
      globalThis.fetch = fetchReal;
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}
