// Arnés del umbral de ENVÍO SIN CARGO, con la excepción por comercio.
// Correr:  npx -y tsx scripts/test-envio.ts
//
// Por qué existe: el umbral decide qué le dice la app a un comercio sobre quién paga el flete, y
// el valor viaja por tres representaciones (la base, un atributo HTML, el JS del navegador). En este
// repo, `0` falso y `Number(null) === 0` ya causaron cuatro bugs de plata. Acá el bug caro sería el
// inverso de siempre: un comercio SIN excepción (null) que termina con umbral 0 = "envío sin cargo
// siempre", en silencio. Eso es exactamente lo que este archivo impide.
import { umbralDe, umbralDelCliente, parseEnvioMin, excepcionesDe, umbralDeSesion } from '../src/lib/envio';
import { FakeDrive } from './fake-drive';
import { instalarFakes } from './fake-supabase';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};
const seccion = (t: string) => console.log(`\n== ${t} ==\n`);

// Ajustes como los devuelve readSettings: strings.
const ajustes = { envio_min_general: '140000', envio_min_chungo: '140000' };

seccion('Sin excepción: hereda el de su lista');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: null }) === 140000, 'null → el de la lista general');
ok(umbralDelCliente(ajustes, { catalog: 'chungo', envio_min: null }) === 140000, 'null → el de la lista chungo');
ok(umbralDelCliente(ajustes, { catalog: 'chungo' }) === 140000, 'campo ausente (columna todavía no creada) → el de la lista');
ok(umbralDelCliente(ajustes, { catalog: 'chungo', envio_min: undefined }) === 140000, 'undefined → el de la lista');

seccion('EL BUG CARO: null NUNCA puede volverse "envío sin cargo siempre"');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: null }) !== 0, 'null no da 0 (Number(null) === 0 es la trampa)');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: '' as any }) === 140000, "'' (campo vacío) → el de la lista, no 0");
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: '   ' as any }) === 140000, "'   ' → el de la lista, no 0");

seccion('Con excepción: manda la del comercio');
ok(umbralDelCliente(ajustes, { catalog: 'chungo', envio_min: 250000 }) === 250000, 'Chungo Pilar: 250.000 aunque la lista diga 140.000');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: 90000 }) === 90000, 'una excepción MENOR que la lista también vale');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: 0 }) === 0, '0 es válido: "envío sin cargo siempre" para ese comercio');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: '250000' as any }) === 250000, 'si viniera como string numérico, se respeta');
ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: 250000.6 }) === 250001, 'se redondea como numeroDe');

seccion('Basura: hereda la lista (nunca regala el envío)');
for (const [v, d] of [[-5, 'negativo'], [NaN, 'NaN'], [Infinity, 'Infinity'], ['abc', "'abc'"], [{}, 'objeto']] as const) {
  ok(umbralDelCliente(ajustes, { catalog: 'general', envio_min: v as any }) === 140000, `${d} → el de la lista`);
}

seccion('Casos de borde de la cuenta');
ok(umbralDelCliente(ajustes, null) === umbralDe(ajustes, 'general'), 'sin cliente (pedido con client_id borrado) → lista general');
ok(umbralDelCliente(ajustes, undefined) === umbralDe(ajustes, 'general'), 'undefined → lista general');
ok(umbralDelCliente(ajustes, { catalog: 'inventada', envio_min: null }) === umbralDe(ajustes, 'general'), 'lista desconocida → cae como catalogOf');

seccion('El default del código para la lista Chungo (solo aplica si falta la fila en la base)');
ok(umbralDe({}, 'chungo') === 140000, 'sin ajustes, chungo = 140.000 (antes 250.000: el error de agosto)');
ok(umbralDe({}, 'general') === 140000, 'sin ajustes, general = 140.000');

seccion('parseEnvioMin — lo que escribe la administradora en la ficha');
const acepta = (v: unknown, esperado: number | null, d: string) => {
  const r = parseEnvioMin(v);
  ok(r.ok === true && (r as any).valor === esperado, `${d} → ${esperado === null ? 'null (usa su lista)' : esperado}`);
};
const rechaza = (v: unknown, d: string) => ok(parseEnvioMin(v).ok === false, `${d} → rechazado`);
acepta('', null, "''");
acepta('   ', null, "'   '");
acepta(null, null, 'null');
acepta(undefined, null, 'undefined');
acepta('250000', 250000, "'250000'");
acepta('250.000', 250000, "'250.000' (con punto de miles)");
acepta('$250.000', 250000, "'$250.000'");
acepta(' $ 250.000 ', 250000, "' $ 250.000 ' (espacios)");
acepta('0', 0, "'0' — válido: envío sin cargo siempre");
acepta(0, 0, 'el número 0');
acepta(250000, 250000, 'el número 250000');
rechaza('1e5', "'1e5' (montoEscrito lo convertía en 15)");
rechaza('-5000', "'-5000'");
rechaza('250,5', "'250,5' (decimales)");
rechaza('abc', "'abc'");
rechaza('250 mil', "'250 mil'");
rechaza('100000000', "'100000000' (fuera de tope)");
// El punto DECIMAL. Mi primera versión borraba todos los puntos "porque son de miles", y con eso
// "1.5" se volvía 15 (envío gratis desde $15): el mismo agujero que "1e5", por otra puerta. Lo
// encontraron cuatro revisores por separado. El punto vale SOLO como separador de miles bien
// formado: grupos de tres dígitos.
rechaza('1.5', "'1.5' (el que se volvía 15)");
rechaza('0.5', "'0.5'");
rechaza('.5', "'.5'");
rechaza('250000.00', "'250000.00' (se volvía 25.000.000)");
rechaza('140000.0', "'140000.0'");
rechaza('2.50.000', "'2.50.000' (grupo de miles mal formado)");
rechaza('25.0000', "'25.0000'");
rechaza('250.0', "'250.0'");
rechaza('0.', "'0.'");
rechaza('. 0', "'. 0'");
rechaza('1 4 0 0 0 0', "'1 4 0 0 0 0' (espacios adentro)");
rechaza('$', "'$' solo");
acepta('1.000.000', 1000000, "'1.000.000' (dos grupos de miles)");
acepta('$0', 0, "'$0'");
rechaza(250000.5, 'el número 250000.5');
rechaza(-1, 'el número -1');
rechaza(NaN, 'NaN');
rechaza({}, 'un objeto');

seccion('Pestaña Envíos: el parser nuevo contra el VIEJO, lado a lado');
// La lógica EXACTA que tenía api/admin/settings.ts antes de este cambio (ya está en producción).
const viejoSettings = (v: unknown): number | 'error' => {
  const digitos = String(v ?? '').replace(/[^\d]/g, '');
  if (!digitos) return 'error';
  const n = Number(digitos);
  if (!Number.isFinite(n) || n > 99_999_999) return 'error';
  return Math.round(n);
};
const nuevoSettings = (v: unknown): number | 'error' => {
  const p = parseEnvioMin(v);
  return !p.ok || p.valor === null ? 'error' : p.valor;
};
// Lo que ella escribe de verdad: estos tienen que dar EXACTAMENTE lo mismo que antes.
const validos = ['140000', '140.000', '$140.000', ' 140000 ', '$ 140.000', '250000', '250.000', '0', '1.000.000', '99999999'];
let iguales = true;
for (const v of validos) {
  if (viejoSettings(v) !== nuevoSettings(v)) {
    iguales = false;
    console.log(`        DIFIERE en ${JSON.stringify(v)}: viejo ${viejoSettings(v)} / nuevo ${nuevoSettings(v)}`);
  }
}
ok(iguales, `los ${validos.length} montos bien escritos dan lo mismo que antes`);
// Estos el viejo los DESTROZABA en silencio; el nuevo los rechaza. Es el único cambio buscado.
const destrozados: [string, number][] = [['1e5', 15], ['140000.00', 14000000], ['1,5', 15], ['1.5', 15], ['140 mil', 140]];
for (const [v, loQueGuardabaElViejo] of destrozados) {
  ok(viejoSettings(v) === loQueGuardabaElViejo && nuevoSettings(v) === 'error',
    `${JSON.stringify(v)}: el viejo guardaba ${loQueGuardabaElViejo.toLocaleString('es-AR')}, el nuevo lo rechaza`);
}
ok(viejoSettings('') === 'error' && nuevoSettings('') === 'error', "'' sigue siendo error en la lista (una lista siempre tiene monto)");

seccion('excepcionesDe — la lista de la pestaña Envíos');
const clientes = [
  { business_name: 'Chungo Local Uno', catalog: 'chungo', envio_min: null, active: true },
  { business_name: 'Chungo Pilar', catalog: 'chungo', envio_min: 250000, active: true },
  { business_name: 'Café Uno', catalog: 'general' },                                    // sin la clave: base antes del SQL
  { business_name: 'Morda', catalog: 'general', envio_min: 0, active: true },
  { business_name: 'Viejo SRL', catalog: 'general', envio_min: 90000, active: false },
];
const ex = excepcionesDe(ajustes, clientes);
ok(ex.length === 3, `solo los que tienen monto propio (${ex.map((e) => e.nombre).join(', ')})`);
ok(!ex.some((e) => e.nombre === 'Chungo Local Uno' || e.nombre === 'Café Uno'), 'null y clave ausente NO aparecen');
const pilar = ex.find((e) => e.nombre === 'Chungo Pilar');
ok(!!pilar && pilar.monto === 250000 && pilar.montoLista === 140000, 'Pilar: 250.000, y su lista dice 140.000');
ok(ex.find((e) => e.nombre === 'Morda')?.monto === 0, 'el 0 aparece (es una excepción, no "nada")');
ok(ex.find((e) => e.nombre === 'Viejo SRL')?.activo === false, 'un comercio dado de baja queda marcado');
ok(excepcionesDe(ajustes, []).length === 0 && excepcionesDe(ajustes, undefined as any).length === 0, 'sin clientes: lista vacía, no rompe');

// ---------------------------------------------------------------------------
seccion('umbralDeSesion — el catálogo, con la base ANTES y DESPUÉS del SQL');
// La protección más importante del cambio. Si alguien la rompe (mete envio_min en una consulta
// estricta, o cambia sbSelect por la estricta), estos casos fallan.
{
  const { supa, desinstalar } = instalarFakes(new FakeDrive());
  const sembrar = (conColumna: boolean) => {
    supa.llamadas.length = 0;
    const base = supa.columnas.teia_clients.filter((c) => c !== 'envio_min');
    supa.columnas.teia_clients = conColumna ? [...base, 'envio_min'] : base;
    supa.tablas = {
      teia_settings: [
        { key: 'envio_min_general', value: '140000' },
        { key: 'envio_min_chungo', value: '140000' },
      ],
      teia_clients: [
        { id: 2, catalog: 'chungo', ...(conColumna ? { envio_min: null } : {}) },
        { id: 3, catalog: 'chungo', ...(conColumna ? { envio_min: 250000 } : {}) },
      ],
    };
  };

  sembrar(true);
  ok(await umbralDeSesion(3, 'chungo') === 250000, 'DESPUÉS del SQL: Pilar ve su 250.000');
  ok(await umbralDeSesion(2, 'chungo') === 140000, 'DESPUÉS del SQL: Local Dos ve el de su lista');

  // Si umbralDeSesion LANZA, en producción es un 500 en el catálogo de todos los comercios. Se
  // captura para que el test lo diga con nombre: la primera vez que lo saboteé a propósito, el
  // test "lo atrapó" como un crash del script, y un crash se lee mal (yo mismo lo leí como verde).
  const sinLanzar = (p: Promise<number>) => p.catch((e) => `LANZÓ: ${e?.message}` as unknown as number);

  sembrar(false);
  const r = await sinLanzar(umbralDeSesion(3, 'chungo'));
  const rechazo = supa.llamadas.some((l) => /select=envio_min/.test(l.url));
  ok(rechazo, 'ANTES del SQL: la consulta de la columna se hizo (y el fake la rechazó con 400)');
  ok(r === 140000, `ANTES del SQL: no rompe, Pilar ve el de su lista (${r})`);

  sembrar(true);
  supa.fallar(/teia_clients/, 503, 1);
  const caida = await sinLanzar(umbralDeSesion(3, 'chungo'));
  ok(caida === 140000, `base caída en esa consulta: el de su lista, sin lanzar (${caida})`);

  sembrar(true);
  ok(await umbralDeSesion(null, 'chungo') === 140000, 'vista previa del panel (sin sesión): el de la lista');
  ok(!supa.llamadas.some((l) => /teia_clients/.test(l.url)), '  ...y ni siquiera consulta la cuenta');

  desinstalar();
}

// ---------------------------------------------------------------------------
seccion('Pestaña Envíos: un panel de antes del deploy no puede devolver Chungo a $250.000');
{
  const { supa, desinstalar } = instalarFakes(new FakeDrive());
  process.env.TEIA_ADMIN_PASSWORD = 'clave-de-prueba';
  const { POST: AJUSTES } = await import('../src/pages/api/admin/settings');
  const postear = async (body: Record<string, any>) => {
    const r = await AJUSTES({ request: new Request('http://localhost/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64') },
      body: JSON.stringify(body),
    }) } as any);
    return { status: r.status, o: await r.json().catch(() => null) };
  };
  const chungo = () => supa.tablas.teia_settings?.find((f: any) => f.key === 'envio_min_chungo')?.value;
  supa.tablas.teia_settings = [{ key: 'envio_min_general', value: '140000' }, { key: 'envio_min_chungo', value: '140000' }];
  supa.llamadas.length = 0;
  // Lo que manda el JS de producción de hoy: TODAS las listas, sin la marca.
  let r = await postear({ envio_min_general: '150000', envio_min_chungo: '250000' });
  ok(r.status === 409 && /antes de la última actualización/.test(r.o?.error || ''), `panel VIEJO con las dos listas → 409 "recargá" (${r.status})`);
  ok(chungo() === '140000' && !supa.llamadas.some((l: any) => l.metodo !== 'GET'), '  ...y no escribió nada: Chungo sigue en 140.000');
  r = await postear({ envio_min_chungo: '150.000', panel: 2 });
  ok(r.status === 200, `el panel nuevo guarda (${r.status} ${r.o?.error || ''})`);
  desinstalar();
}

// ---------------------------------------------------------------------------
seccion('Guardián: ninguna consulta ESTRICTA sobre teia_clients nombra envio_min');
// La trampa de julio fue exactamente esto: una columna nueva sumada a un select explícito y
// estricto, antes de su SQL. Hay cinco consultas así en caminos de los comercios (login, catálogo,
// checkout, pedido, ajustes). Este test lee el código y falla si alguna la nombra — también las
// que se escriban mañana.
{
  const archivos: string[] = [];
  const recorrer = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.(ts|astro)$/.test(n)) archivos.push(p);
    }
  };
  recorrer(join(process.cwd(), 'src'));
  const culpables: string[] = [];
  let estrictasSobreClientes = 0;
  // La columna, no las claves de ajustes ('envio_min_chungo'): el token sin "_" detrás.
  const columna = /envio_min(?!_)/;
  for (const f of archivos) {
    const txt = readFileSync(f, 'utf8');
    // Sin comentarios (los avisos "NO sumar envio_min acá" no son uso). El `[^:]` salva los http://.
    const codigo = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Hasta el ';' de la sentencia, NO hasta el primer ')': la versión anterior cortaba en el ')'
    // de `${Number(pedido.client_id)}` y no veía lo que venía después (auditoría del 19/9).
    // Sobre el código SIN comentarios, con el genérico opcional (`sbSelectStrict<any>(`, que ya se
    // usa), y si el argumento es una variable (`sbSelectStrict(ruta)`) se mira lo que vale la variable.
    for (const m of codigo.matchAll(/sbSelectStrict\s*(?:<[^>()]*>)?\s*\(([^;]*)/g)) {
      let arg = m[1];
      const ident = arg.trim().match(/^([A-Za-z_$][\w$]*)\s*[),]/);
      if (ident) {
        const def = codigo.match(new RegExp('(?:const|let|var)\\s+' + ident[1] + '\\s*=\\s*([^;]*)'));
        if (def) arg = def[1];
      }
      if (!/teia_clients/.test(arg)) continue;
      estrictasSobreClientes++;
      if (columna.test(arg)) culpables.push(`${f.replace(process.cwd(), '')}: ${arg.trim().slice(0, 90)}`);
      // Si la consulta arma sus COLUMNAS con una variable (el login: `select=${cols}`), el guardián no
      // puede seguirla: en ese archivo la columna no puede aparecer EN NINGÚN LADO del código. Una
      // interpolación en un filtro (`id=eq.${id}`) no nombra columnas y no cuenta.
      else if (/select=[^&`'"]*\$\{/.test(arg) && columna.test(codigo)) {
        culpables.push(`${f.replace(process.cwd(), '')}: consulta estricta con \${…} en un archivo que nombra envio_min`);
      }
    }
  }
  ok(estrictasSobreClientes >= 5, `encontró las consultas estrictas sobre teia_clients (${estrictasSobreClientes}) — si da 0, el guardián está ciego`);
  ok(culpables.length === 0, 'ninguna nombra envio_min' + (culpables.length ? ':\n        ' + culpables.join('\n        ') : ''));
}

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
process.exit(fallas ? 1 : 0);
