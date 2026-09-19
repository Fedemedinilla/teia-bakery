// Arnés de `archiveOrder` — el camino por el que pasa CADA confirmación de pedido en producción.
// Correr:  npx -y tsx scripts/test-archive.ts
//
// Lo que se prueba acá no es que la copia para imprimir funcione (eso lo cubre test-drive).
// Es lo contrario: que NO pueda romper nada. La copia es lo último y es best effort, y esas dos
// propiedades tienen que ser verificables, no una intención escrita en un comentario.
import { FakeDrive } from './fake-drive';
import { instalarFakes } from './fake-supabase';

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};
const seccion = (t: string) => console.log(`\n== ${t} ==\n`);

const drive = new FakeDrive();
const { supa, desinstalar } = instalarFakes(drive);
const { archiveOrder } = await import('../src/pages/api/admin/archive');
const G = await import('../src/lib/google');

const AHORA = Date.now();
const haceHoras = (h: number) => new Date(AHORA - h * 3600 * 1000).toISOString();

function sembrar(over: Record<string, any> = {}) {
  drive.archivos.clear(); drive.llamadas.length = 0; drive.limpiarFallas();
  supa.objetos.clear(); supa.llamadas.length = 0;
  supa.tablas = {
    teia_orders: [{
      id: 28, order_number: 'TEIA-9028', client_name: 'Chungo Local Dos',
      client_contact: '1100000002', delivery_address: 'Calle Falsa 202, local 2',
      status: 'confirmado', total: 857900, discount_pct: 0, version: 1,
      created_at: haceHoras(3), confirmed_at: haceHoras(2),
      archive_status: null, archive_error: null, remito_cliente_url: null,
      ...over,
    }],
    teia_order_items: [
      { id: 1, order_id: 28, name: 'Chipá', pack_label: 'x12', qty: 70, unit_price: 2100, line_total: 147000 },
      { id: 2, order_id: 28, name: 'Cheesecake', pack_label: 'x6', qty: 4, unit_price: 24000, line_total: 96000 },
    ],
  };
}
const pedido = () => supa.tablas.teia_orders[0];
const carpetaPrint = () => [...drive.archivos.values()].find((a) => a.appProperties.teia_role === 'print' && !a.trashed);
const enImpresion = () => (carpetaPrint() ? drive.hijos(carpetaPrint()!.id).map((f) => f.name) : []);

// ---------------------------------------------------------------------------
seccion('Camino feliz — el pedido se archiva Y la copia llega a imprimir');

sembrar();
let r = await archiveOrder(28);
ok(r.ok === true, 'archiveOrder devuelve ok');
ok(pedido().archive_status === 'archivado', "archive_status queda 'archivado'");
ok(!!pedido().remito_cliente_url, 'el remito queda guardado en el pedido');
ok(supa.objetos.size === 1, 'el PDF está en Storage');
ok(drive.arbol().some((l) => /Septiembre|Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Octubre|Noviembre|Diciembre/.test(l)), 'el archivador por año/mes/comercio sigue funcionando');
ok(enImpresion().length === 1, 'y hay UNA copia en la carpeta de impresión');
ok(enImpresion()[0] === G.printFileName(pedido()), `con el nombre de printFileName (${enImpresion()[0]})`);

// EL ORDEN, verificado de verdad y no solo declarado. El PATCH que vuelve durable el estado del
// pedido tiene que ocurrir ANTES de la primera llamada de la copia para imprimir. Si algún día
// alguien mueve el bloque hacia arriba, una lambda que se muera en la copia dejaría el pedido
// marcado sin archivar con el remito perfecto y subido — y este test es lo único que lo impide.
// (La auditoría marcó que antes yo calculaba el índice del PATCH y nunca lo comparaba con nada.)
const uploadsPrint = drive.llamadas.filter((l) => l.url.includes('/upload/drive/v3/files'));
ok(uploadsPrint.length === 2, 'se subieron 2 PDFs a Drive (archivador + impresión)');

const tPatch = supa.llamadas.findLastIndex((l) => l.metodo === 'PATCH' && l.cuerpo?.archive_status === 'archivado');
const tCopia = drive.llamadas.findIndex((l) => /'print'/.test(l.url));
ok(tPatch >= 0, 'hubo un PATCH que marca archivado');
ok(tCopia >= 0, 'hubo una llamada a la carpeta de impresión');
// Los dos relojes son distintos (uno cuenta llamadas a Supabase y otro a Drive), así que se
// compara por tiempo real: se marca el instante de cada uno.
const momentoPatch = supa.llamadas[tPatch]?.momento ?? -1;
const momentoCopia = drive.llamadas[tCopia]?.momento ?? -1;
ok(momentoPatch > 0 && momentoCopia > 0, 'ambos quedaron sellados con su instante');
ok(momentoPatch <= momentoCopia, `el PATCH durable ocurrió ANTES de la copia (${momentoPatch} <= ${momentoCopia})`);

// ---------------------------------------------------------------------------
seccion('Un fallo de la carpeta de impresión NO puede tocar el pedido');

sembrar();
// SOLO la búsqueda de la carpeta de impresión: así no se toca la raíz (value='root') ni el
// archivador por año/mes/comercio, que tienen que seguir funcionando.
// ⚠️ Va con comillas LITERALES: encodeURIComponent no codifica la comilla simple, así que en la
// URL viaja como value='print'. Con /%27print%27/ el patrón no matcheaba nunca y esta sección
// entera daba verde sin haber inyectado un solo fallo. Por eso ahora se verifica que disparó.
drive.fallar(/'print'/, 500, 99);
r = await archiveOrder(28);
ok(drive.fallasDisparadas() > 0, `el fallo inyectado DISPARÓ de verdad (${drive.fallasDisparadas()} veces)`);
ok(r.ok === true, 'archiveOrder SIGUE devolviendo ok');
ok(pedido().archive_status === 'archivado', "archive_status sigue siendo 'archivado', no 'error'");
ok(pedido().archive_error === null, 'no se escribió ningún error en el pedido');
ok(!!pedido().remito_cliente_url, 'el remito sigue estando');
ok(enImpresion().length === 0, '  ...y simplemente no hay copia para imprimir');

// ---------------------------------------------------------------------------
seccion('La copia se toma su tiempo — el pedido no la espera para siempre');

sembrar();
// Drive que nunca contesta: el withDeadline de 5s tiene que cortar.
const lento = new FakeDrive();
const fetchAnterior = globalThis.fetch;
let colgadas = 0;
globalThis.fetch = (async (e: any, i: any = {}) => {
  const u = String(e);
  if (u.startsWith('https://fake.supabase.co/')) return supa.responder(u, i);
  // Cuelga SOLO la búsqueda de la carpeta de impresión: el resto del archivado tiene que poder
  // completarse. (El archivador no tiene deadline propio — es preexistente y no es lo que se mide acá.)
  if (/'print'/.test(u)) { colgadas++; return new Promise(() => {}) as any; }
  return lento.fetch(e, i);
}) as typeof fetch;

const t0 = Date.now();
r = await archiveOrder(28);
const tardo = Date.now() - t0;
globalThis.fetch = fetchAnterior;

ok(colgadas > 0, `alguna petición quedó colgada de verdad (${colgadas})`);
ok(r.ok === true, 'con Drive colgado, el pedido igual se archiva');
ok(pedido().archive_status === 'archivado', "  ...y queda 'archivado'");
// El piso importa tanto como el techo: si tardara ~0s, el deadline no habría llegado a actuar
// y estaríamos midiendo otra cosa.
ok(tardo >= 4500 && tardo < 9000, `corta por el deadline, no antes ni mucho después (tardó ${(tardo / 1000).toFixed(1)}s, tope 5s)`);

// ---------------------------------------------------------------------------
seccion('Pedidos viejos NO se vuelcan en la carpeta recién compartida');

sembrar({ confirmed_at: haceHoras(72), created_at: haceHoras(73) });
r = await archiveOrder(28);
ok(r.ok === true, 'un pedido de hace 72 h se archiva igual');
ok(enImpresion().length === 0, '  ...pero NO va a la carpeta de impresión (tope de 48 h)');

sembrar({ confirmed_at: haceHoras(47) });
await archiveOrder(28);
ok(enImpresion().length === 1, 'uno de hace 47 h sí va (el corte está donde dice)');

// ---------------------------------------------------------------------------
seccion('Un pedido no confirmado nunca llega a la carpeta del local');

sembrar({ status: 'pendiente' });
await archiveOrder(28);
ok(enImpresion().length === 0, "un pedido 'pendiente' no se copia para imprimir");

sembrar({ status: 'entregado' });
await archiveOrder(28);
ok(enImpresion().length === 1, "uno 'entregado' sí (ya salió, pueden querer reimprimirlo)");

// ---------------------------------------------------------------------------
seccion('Reintentar no duplica');

sembrar();
await archiveOrder(28);
await archiveOrder(28);
await archiveOrder(28);
ok(enImpresion().length === 1, '3 archivados seguidos dejan UN archivo en impresión');
ok([...drive.archivos.values()].filter((a) => a.appProperties.teia_role === 'print').length === 1, '  ...y UNA carpeta');

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
desinstalar();
process.exit(fallas ? 1 : 0);
