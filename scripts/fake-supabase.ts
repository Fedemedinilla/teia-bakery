// Supabase FALSA (PostgREST + Storage) en memoria, para probar los endpoints sin base.
//
// Cubre lo justo que usa la app: select con filtros `eq`, patch por filtro, insert, y el
// object store. No pretende ser Postgres: pretende ser un instrumento honesto sobre el que se
// pueda afirmar "un fallo de Drive NO mueve archive_status" y que esa afirmación signifique algo.
//
// Se combina con FakeDrive a través de `enrutar`, porque los dos interceptan el mismo fetch.

import { reloj } from './fake-drive';

export type Fila = Record<string, any>;

export class FakeSupabase {
  tablas: Record<string, Fila[]> = {};
  objetos = new Map<string, Uint8Array>();
  llamadas: { metodo: string; url: string; cuerpo?: any; momento: number }[] = [];

  /**
   * Las columnas que EXISTEN en cada tabla. Si una tabla está acá, el fake se comporta como
   * PostgREST ante una columna desconocida:
   *   · en un `select=a,b` explícito → 400 { code: '42703' }  (rechaza la consulta ENTERA)
   *   · en el cuerpo de un PATCH/POST → 400 { code: 'PGRST204' }
   * `select=*` nunca falla: devuelve lo que haya.
   *
   * Existe por la trampa de julio: agregar una columna a un select explícito ANTES de correr su
   * SQL dejó sin login a todos los clientes. Antes este fake ignoraba el select, así que esa
   * clase de bug pasaba en verde en las pruebas y rompía en producción. Sin una tabla acá, el
   * comportamiento es el de siempre (no valida nada).
   */
  columnas: Record<string, string[]> = {};

  /** El último id entregado por tabla: una identity no reusa ids aunque se borren filas. */
  private ultimoId: Record<string, number> = {};

  /** ¿Existe la función teia_armar_pedido? false = el SQL de la tarea 3 sin correr (404 PGRST202). */
  funcionArmar = true;
  /** Si se pone, la PRÓXIMA llamada a la función devuelve esto tal cual (200), sin tocar nada. */
  respuestaArmarForzada: any = undefined;

  private nuevoId(tabla: string): number {
    const maxId = (this.tablas[tabla] || []).reduce((m, f) => Math.max(m, Number(f.id) || 0), this.ultimoId[tabla] || 0);
    this.ultimoId[tabla] = maxId + 1;
    return maxId + 1;
  }

  /**
   * La función SQL teia_armar_pedido (supabase/2026-09-19-armar-pedidos.sql), emulada con las MISMAS
   * reglas que se probaron contra Postgres de verdad (PGlite, scratchpad/pg/test-sql-armar.mjs):
   * idempotente por armado_id, todo o nada (nada se escribe hasta validar todo), NOT NULL, claves
   * foráneas, fechas que existen, cantidades enteras, numeric(12,2) redondeado como Postgres (sobre el
   * texto decimal, no sobre el binario) y el número TEIA-NNNN sin recortar desde el 1000.
   */
  private armarPedido(p: any): { status: number; cuerpo: any } {
    const err = (status: number, code: string, message: string) => ({ status, cuerpo: { code, message } });
    const armado = p?.armado_id;
    if (typeof armado !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(armado)) return err(400, '22023', 'armado_id inválido');
    // La huella de las líneas GUARDADAS, con el mismo formato que la función SQL (string_agg ordenado por
    // producto y cantidad): así el servidor compara lo que llega con lo que de verdad quedó.
    const huella = (id: number) => (this.tablas.teia_order_items || []).filter((l) => l.order_id === id && l.product_id != null) // string_agg saltea los null
      .sort((a, b) => Number(a.product_id) - Number(b.product_id) || Number(a.qty) - Number(b.qty))
      .map((l) => `${l.product_id}x${l.qty}`).join(',');
    const resumen = (o: Fila, repetido: boolean) => ({
      id: o.id, order_number: o.order_number, total: Number(o.total), discount_pct: Number(o.discount_pct) || 0,
      status: o.status, client_id: o.client_id, huella: huella(o.id), repetido,
    });
    const ya = (this.tablas.teia_orders || []).find((o) => o.armado_id === armado);
    if (ya) return { status: 200, cuerpo: resumen(ya, true) };
    if (p.solo_buscar === true || p.solo_buscar === 'true') return { status: 200, cuerpo: null };
    if (!Array.isArray(p.items) || !p.items.length) return err(400, '22023', 'el pedido no tiene líneas');
    const texto = (v: any) => (v === null || v === undefined ? null : String(v));
    const numeric2 = (v: any) => {
      const s = texto(v);
      const m = s && s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
      if (!m) return undefined;
      const dec = (m[3] || '').padEnd(3, '0');
      let cent = BigInt(m[2]) * 100n + BigInt(dec.slice(0, 2));
      if (Number(dec[2]) >= 5) cent += 1n; // mitad hacia afuera, como numeric
      return Number(`${m[1]}${cent / 100n}.${String(cent % 100n).padStart(2, '0')}`);
    };
    for (const k of ['client_name', 'client_contact', 'delivery_address']) {
      if (texto(p[k]) === null) return err(400, '23502', `null value in column "${k}" of relation "teia_orders"`);
    }
    const total = numeric2(p.total);
    if (total === undefined) return err(400, '22P02', 'invalid input syntax for type numeric');
    if (p.client_id != null && !(this.tablas.teia_clients || []).some((c) => String(c.id) === String(p.client_id))) {
      return err(409, '23503', 'insert or update on table "teia_orders" violates foreign key constraint');
    }
    const fecha = texto(p.delivery_date) || null;
    if (fecha) {
      const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const f = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!m || !f || f.getUTCMonth() !== +m[2] - 1 || f.getUTCDate() !== +m[3]) return err(400, '22008', 'date/time field value out of range');
    }
    const lineas: Fila[] = [];
    for (const i of p.items) {
      if (texto(i?.name) === null) return err(400, '23502', 'null value in column "name" of relation "teia_order_items"');
      if (!/^-?\d+$/.test(String(i.qty))) return err(400, '22P02', `invalid input syntax for type integer: "${i.qty}"`);
      const unit = numeric2(i.unit_price), linea = numeric2(i.line_total);
      if (unit === undefined || linea === undefined) return err(400, '23502', 'null value in column "unit_price" of relation "teia_order_items"');
      if (i.product_id != null && !(this.tablas.teia_products || []).some((x) => String(x.id) === String(i.product_id))) {
        return err(409, '23503', 'insert or update on table "teia_order_items" violates foreign key constraint');
      }
      lineas.push({ product_id: i.product_id == null ? null : Number(i.product_id), name: String(i.name), pack_label: texto(i.pack_label) ?? '',
        qty: Number(i.qty), unit_price: unit, line_total: linea });
    }
    // Todo validado: recién ahora se escribe (en Postgres, un error deshace todo igual).
    this.tablas.teia_orders ||= [];
    this.tablas.teia_order_items ||= [];
    const id = this.nuevoId('teia_orders');
    const order_number = 'TEIA-' + (id < 1000 ? String(id).padStart(4, '0') : String(id));
    this.tablas.teia_orders.push({
      id, order_number, client_id: p.client_id == null ? null : Number(p.client_id), client_name: String(p.client_name),
      client_contact: String(p.client_contact), delivery_address: String(p.delivery_address), delivery_date: fecha,
      notes: texto(p.notes) ?? '', status: 'pendiente', version: 1, total, discount_pct: Number(p.discount_pct) || 0,
      created_at: new Date().toISOString(), placed_by: 'teia', armado_id: armado,
    });
    for (const l of lineas) this.tablas.teia_order_items.push({ id: this.nuevoId('teia_order_items'), order_id: id, ...l });
    return { status: 200, cuerpo: resumen(this.tablas.teia_orders.find((o) => o.id === id)!, false) };
  }

  private columnaDesconocida(tabla: string, nombres: string[]): string | null {
    const validas = this.columnas[tabla];
    if (!validas) return null;
    return nombres.find((n) => n && n !== '*' && !validas.includes(n)) || null;
  }

  /**
   * Las columnas que NOMBRA un request de PostgREST, como las ve PostgREST: las del `select` (sin
   * el alias `alias:col` ni el cast `col::tipo`; los embebidos `rel(...)` no se validan), las de
   * `order=col.asc,col2.desc`, y la clave de cada filtro (`col=eq.X`). Antes este fake miraba solo
   * el `select`, así que un filtro o un orden por una columna inexistente pasaba en verde acá y
   * daba 400 en producción.
   */
  private columnasNombradas(params: URLSearchParams): string[] {
    const sinAliasNiCast = (s: string) => s.trim().replace(/^[^:()]+:(?!:)/, '').replace(/::.*$/, '');
    const delSelect = (params.get('select') || '*').split(',').map(sinAliasNiCast).filter((s) => s && !s.includes('('));
    const delOrden = (params.get('order') || '').split(',').map((s) => s.trim().split('.')[0]).filter(Boolean);
    const deFiltros = [...params.keys()].filter((k) => !['select', 'order', 'limit', 'offset', 'or', 'and'].includes(k));
    return [...delSelect, ...delOrden, ...deFiltros];
  }

  private fallas: { patron: RegExp; status: number; veces: number; code?: string; metodo?: string; disparos: number; saltear: number }[] = [];
  /**
   * Hace fallar las próximas `veces` llamadas cuyo URL matchee. Con `code`, el cuerpo es el JSON
   * que manda PostgREST ({ code, message }) — p. ej. '23505' para un CUIT repetido — para que el
   * código pueda distinguir una causa de otra. Con `metodo`, solo falla ese verbo. Con `saltear`, deja
   * pasar las primeras N llamadas que matchean (el armado llama a la misma función dos veces: primero
   * busca, después crea; sin esto la falla le pegaba a la búsqueda y la prueba dejaba de probar la creación).
   */
  fallar(patron: RegExp, status = 500, veces = 1, code?: string, metodo?: string, saltear = 0) {
    this.fallas.push({ patron, status, veces, code, metodo, disparos: 0, saltear });
  }
  fallasDisparadas(): number {
    return this.fallas.reduce((n, f) => n + f.disparos, 0);
  }

  /**
   * Corre `fn` DESPUÉS de responder el próximo request que matchee (URL y verbo). Sirve para meter
   * un evento ajeno justo en el medio de una operación — p. ej. "alguien confirmó el pedido entre
   * el claim de la edición y su guardado final" — que es la carrera que no se ve con dos requests
   * seguidos. `disparos` dice si ocurrió de verdad.
   */
  private ganchos: { patron: RegExp; metodo: string; fn: () => void; disparos: number; saltear: number }[] = [];
  despuesDe(patron: RegExp, metodo: string, fn: () => void, saltear = 0) {
    const g = { patron, metodo, fn, disparos: 0, saltear };
    this.ganchos.push(g);
    return g;
  }
  limpiarGanchos() { this.ganchos.length = 0; }
  private correrGanchos(url: string, metodo: string) {
    for (const g of this.ganchos) {
      if (g.disparos === 0 && g.metodo === metodo && g.patron.test(url)) {
        if (g.saltear > 0) { g.saltear--; continue; }
        g.disparos++; g.fn();
      }
    }
  }

  /** Aplica los filtros `col=eq.valor` de la query a una tabla. */
  /**
   * Los filtros de PostgREST que usa la app: eq, neq, in.(a,b), is.true/false/null y not.is.X.
   *
   * ⚠️ Un operador que el fake NO entiende se REPORTA, no se ignora. Antes este filtro solo leía
   * `eq.` y dejaba pasar el resto en silencio: un `in.(3,4)` devolvía TODAS las filas, así que un
   * test del tipo "solo productos de la lista de este comercio" pasaba en verde con el filtro
   * roto. Un fake que ignora una condición es un fake que miente justo donde más importa.
   */
  operadoresNoSoportados: string[] = [];
  private filtrar(tabla: string, params: URLSearchParams): Fila[] {
    let filas = this.tablas[tabla] || [];
    const cumple = (valor: any, op: string, arg: string): boolean | null => {
      if (op === 'eq') return String(valor) === arg;
      if (op === 'neq') return String(valor) !== arg;
      // Comparaciones (la lectura paginada por rangos de id usa `id=gt.N`). Número si los dos lo son.
      if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
        if (valor === null || valor === undefined) return false;
        const a = typeof valor === 'number' && arg !== '' && Number.isFinite(Number(arg)) ? valor : String(valor);
        const b = typeof a === 'number' ? Number(arg) : arg;
        return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
      }
      if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim()).includes(String(valor));
      if (op === 'is') {
        if (arg === 'null') return valor === null || valor === undefined;
        if (arg === 'true') return valor === true;
        if (arg === 'false') return valor === false;
      }
      return null; // no soportado
    };
    for (const [k, v] of params.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = String(v).match(/^(not\.)?([a-z]+)\.(.*)$/);
      const prueba = m ? cumple(undefined, m[2], m[3]) : null;
      if (!m || prueba === null) {
        this.operadoresNoSoportados.push(`${tabla}?${k}=${v}`);
        console.error(`  [fake-supabase] OPERADOR NO SOPORTADO: ${tabla}?${k}=${v} — el test no está probando este filtro`);
        continue;
      }
      const negado = !!m[1];
      filas = filas.filter((f) => {
        const r = cumple(f[k], m[2], m[3]) as boolean;
        return negado ? !r : r;
      });
    }
    return filas;
  }

  /**
   * Tope de filas por respuesta, como `db-max-rows` de PostgREST (en Supabase: 1000 por defecto). Un
   * GET nunca devuelve más aunque pida un `limit` mayor, y lo hace SIN avisar. Por defecto sin tope,
   * para no cambiar las pruebas que no lo miran; las que prueban paginación lo ponen en 1000.
   */
  maxFilas = Infinity;

  /**
   * `order=col.asc,col2.desc`, con `.nullsfirst` / `.nullslast` opcionales. Sin modificador, como
   * Postgres: los null van al final en asc y al principio en desc.
   * ⚠️ Los EMPATES los resuelve por orden de inserción, y Postgres NO garantiza eso entre consultas
   * distintas. O sea: un orden que no es total (sin desempate por una columna única) acá sale
   * estable y en la base real no. Por eso la lectura paginada (sbSelectTodoStrict) ordena por `id`,
   * que no empata nunca, y no depende de este detalle.
   */
  private ordenar(filas: Fila[], orden: string | null): Fila[] {
    if (!orden) return filas;
    const claves = orden.split(',').map((s) => {
      const [col, dir, nulos] = s.trim().split('.');
      const desc = dir === 'desc';
      return { col, desc, nullsPrimero: nulos ? nulos === 'nullsfirst' : desc };
    });
    const vacio = (v: any) => v === null || v === undefined;
    return filas
      .map((f, i) => ({ f, i }))
      .sort((x, y) => {
        for (const k of claves) {
          const a = x.f[k.col], b = y.f[k.col];
          if (vacio(a) || vacio(b)) {
            if (vacio(a) && vacio(b)) continue;
            return (vacio(a) ? -1 : 1) * (k.nullsPrimero ? 1 : -1);
          }
          const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
          if (c) return k.desc ? -c : c;
        }
        return x.i - y.i;
      })
      .map((x) => x.f);
  }

  maneja(url: string): boolean {
    return url.startsWith('https://fake.supabase.co/');
  }

  async responder(url: string, init: any = {}): Promise<Response> {
    const r = await this.responderInterno(url, init);
    this.correrGanchos(url, (init.method || 'GET').toUpperCase());
    return r;
  }

  private async responderInterno(url: string, init: any = {}): Promise<Response> {
    const metodo = (init.method || 'GET').toUpperCase();
    let cuerpo: any;
    if (init.body && typeof init.body === 'string') { try { cuerpo = JSON.parse(init.body); } catch {} }
    this.llamadas.push({ metodo, url, cuerpo, momento: reloj() });

    const falla = this.fallas.find((f) => {
      if (!(f.veces > 0 && f.patron.test(url) && (!f.metodo || f.metodo === metodo))) return false;
      if (f.saltear > 0) { f.saltear--; return false; }
      return true;
    });
    if (falla) {
      falla.veces -= 1;
      falla.disparos += 1;
      if (falla.status === 0) throw new TypeError('fetch failed (falla de red inyectada)');
      return falla.code
        ? new Response(JSON.stringify({ code: falla.code, message: 'falla inyectada' }), { status: falla.status, headers: { 'Content-Type': 'application/json' } })
        : new Response('falla inyectada', { status: falla.status });
    }

    const json = (o: unknown, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

    // --- Storage ---
    const obj = url.match(/\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (obj) {
      const clave = `${obj[1]}/${decodeURIComponent(obj[2])}`;
      if (metodo === 'POST') {
        const bytes = init.body instanceof Uint8Array ? init.body : new Uint8Array(init.body);
        this.objetos.set(clave, bytes);
        return json({ Key: clave });
      }
      if (metodo === 'GET') {
        const bytes = this.objetos.get(clave);
        if (!bytes) return new Response('no existe', { status: 404 });
        return new Response(bytes as any, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
      }
    }

    // --- Funciones SQL (POST /rest/v1/rpc/<nombre>) ---
    const rpc = url.match(/\/rest\/v1\/rpc\/([^?]+)$/);
    if (rpc && metodo === 'POST') {
      if (rpc[1] !== 'teia_armar_pedido' || !this.funcionArmar) {
        return json({ code: 'PGRST202', message: `Could not find the function public.${rpc[1]} in the schema cache` }, 404);
      }
      if (this.respuestaArmarForzada !== undefined) {
        const forzada = this.respuestaArmarForzada;
        this.respuestaArmarForzada = undefined;
        return json(forzada);
      }
      const r = this.armarPedido(cuerpo?.p);
      return json(r.cuerpo, r.status);
    }

    // --- PostgREST ---
    const rest = url.match(/\/rest\/v1\/([^?]+)\??(.*)$/);
    if (rest) {
      const tabla = rest[1];
      const params = new URLSearchParams(rest[2]);
      this.tablas[tabla] ||= [];

      // Columnas inexistentes, como las rechaza PostgREST (ver `columnas`): en el select, el orden y
      // los filtros. En un PATCH/DELETE los filtros también cuentan (`id=eq.X` nombra `id`).
      const pedidas = (params.get('select') || '*').split(',').map((s) => s.trim());
      const malaSelect = this.columnaDesconocida(tabla, this.columnasNombradas(params));
      if (malaSelect) {
        return json({ code: '42703', message: `column ${tabla}.${malaSelect} does not exist` }, 400);
      }
      if ((metodo === 'PATCH' || metodo === 'POST') && cuerpo) {
        const claves = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).flatMap((f: Fila) => Object.keys(f || {}));
        const malaCuerpo = this.columnaDesconocida(tabla, claves);
        if (malaCuerpo) {
          return json({ code: 'PGRST204', message: `Could not find the '${malaCuerpo}' column of '${tabla}' in the schema cache` }, 400);
        }
      }

      if (metodo === 'GET') {
        // Orden, offset, limit y el tope de filas, como PostgREST. Antes el fake ignoraba los tres, así
        // que ninguna prueba podía ver que Supabase corta en 1000 filas: el espejo del Sheet pedía
        // limit=8000 y "andaba" (auditoría del 19/9).
        let filas = this.ordenar(this.filtrar(tabla, params), params.get('order'));
        const offset = Number(params.get('offset') || 0);
        const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
        filas = filas.slice(offset, offset + Math.min(limit, this.maxFilas));
        // Un select explícito devuelve SOLO esas columnas, como PostgREST.
        if (pedidas.includes('*')) return json(filas);
        return json(filas.map((f) => Object.fromEntries(pedidas.filter((p) => p in f).map((p) => [p, f[p]]))));
      }

      if (metodo === 'PATCH') {
        const afectadas = this.filtrar(tabla, params);
        for (const f of afectadas) Object.assign(f, cuerpo);
        const prefer = (init.headers || {})['Prefer'] || '';
        return prefer.includes('representation') ? json(afectadas) : new Response(null, { status: 204 });
      }

      if (metodo === 'POST') {
        // Ids como una identity de Postgres: siempre crecen y nunca se repiten. Antes era
        // `length + 1` para TODO el lote: un alta de dos líneas les daba el mismo id a las dos (y
        // después de un DELETE se reusaban ids), así que un PATCH por id tocaba filas de más y un
        // test de "se insertó una sola línea" podía pasar mintiendo.
        const maxId = (this.tablas[tabla] || []).reduce((m, f) => Math.max(m, Number(f.id) || 0), this.ultimoId[tabla] || 0);
        const nuevas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).map((f: Fila, i: number) => ({
          id: maxId + 1 + i, ...f,
        }));
        this.ultimoId[tabla] = maxId + nuevas.length;
        this.tablas[tabla].push(...nuevas);
        return json(nuevas);
      }

      if (metodo === 'DELETE') {
        const afectadas = this.filtrar(tabla, params);
        this.tablas[tabla] = this.tablas[tabla].filter((f) => !afectadas.includes(f));
        // `on delete cascade` de schema.sql: borrar un pedido borra sus líneas en la base real. Sin
        // esto, una prueba de "dos Borrar a la vez" no podía ver que el que pierde se lleva las
        // líneas antes de que el que gana las lea (auditoría del 19/9).
        if (tabla === 'teia_orders' && this.tablas.teia_order_items) {
          const ids = new Set(afectadas.map((f) => String(f.id)));
          this.tablas.teia_order_items = this.tablas.teia_order_items.filter((l) => !ids.has(String(l.order_id)));
        }
        const prefer = (init.headers || {})['Prefer'] || '';
        return prefer.includes('representation') ? json(afectadas) : new Response(null, { status: 204 });
      }
    }

    throw new Error(`FakeSupabase: no sé responder ${metodo} ${url}`);
  }
}

/**
 * Instala Supabase falsa + Drive falso sobre el mismo `globalThis.fetch`, y las env vars que
 * `supaConfigured()` y `gConfigured()` necesitan. Devuelve los dos y cómo desinstalar.
 */
export function instalarFakes(drive: { fetch: (u: any, i?: any) => Promise<Response> }): {
  supa: FakeSupabase;
  desinstalar: () => void;
} {
  const supa = new FakeSupabase();
  const fetchReal = globalThis.fetch;
  const antes: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-falsa',
    GOOGLE_OAUTH_CLIENT_ID: 'cliente-falso',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secreto-falso',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-falso',
  };
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }

  // Por defecto, teia_clients tiene las columnas de PRODUCCIÓN HOY (sin envio_min): toda suite
  // corre "antes del SQL" salvo que declare otra cosa. Así, si un cambio futuro suma una columna
  // nueva a una consulta sobre teia_clients sin su SQL, la suite que lo toque falla acá y no en
  // producción. Una suite que necesite la columna la agrega a mano (ver test-cliente).
  supa.columnas.teia_clients = [
    'id', 'cuit', 'business_name', 'client_contact', 'delivery_address', 'catalog', 'active',
    'access_code', 'discount_pct', 'notes', 'created_at', 'last_order_at',
  ];

  globalThis.fetch = (async (entrada: any, init: any = {}) => {
    const url = String(entrada);
    if (supa.maneja(url)) return supa.responder(url, init);
    return drive.fetch(entrada, init);
  }) as typeof fetch;

  return {
    supa,
    desinstalar() {
      globalThis.fetch = fetchReal;
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    },
  };
}
