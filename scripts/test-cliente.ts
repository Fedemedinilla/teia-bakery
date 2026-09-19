// Arnés de la FICHA de un comercio (/api/admin/client), con el envío sin cargo propio.
// Correr:  npx -y tsx scripts/test-cliente.ts
//
// Lo que se prueba acá es sobre todo el ORDEN SQL/DEPLOY. La columna `envio_min` llega con una
// migración, y en julio una columna nueva sin su SQL dejó sin login a todos los clientes. La ficha
// es el mismo riesgo del lado de la escritura: si el guardado nombra una columna que no existe,
// PostgREST rechaza el PATCH entero y no se guarda NADA (ni la contraseña). Por eso cada caso se
// corre dos veces: con la base ANTES del SQL y DESPUÉS.
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
process.env.TEIA_ADMIN_PASSWORD = 'clave-de-prueba';
const { POST } = await import('../src/pages/api/admin/client');

const COLS_BASE = ['id', 'cuit', 'business_name', 'client_contact', 'delivery_address', 'catalog',
  'active', 'access_code', 'discount_pct', 'notes', 'created_at', 'last_order_at'];

function sembrar({ conColumna }: { conColumna: boolean }) {
  supa.llamadas.length = 0;
  supa.columnas = { teia_clients: conColumna ? [...COLS_BASE, 'envio_min'] : COLS_BASE };
  supa.tablas = {
    teia_clients: [{
      id: 7, cuit: '30000000015', business_name: 'Chungo Pilar', client_contact: '11', delivery_address: 'Pilar',
      catalog: 'chungo', active: true, access_code: 'VIEJA', discount_pct: 0, notes: '',
      ...(conColumna ? { envio_min: null } : {}),
    }],
  };
}
const cuenta = () => supa.tablas.teia_clients[0];
const patches = () => supa.llamadas.filter((l) => l.metodo === 'PATCH');

// El panel nuevo manda `panel: 2` en las ediciones (lib/panel.ts); `guardarViejo` es uno de antes del deploy.
const guardar = (body: Record<string, any>) => postear(body.id ? { panel: 2, ...body } : body);
const guardarViejo = (body: Record<string, any>) => postear(body);
async function postear(body: Record<string, any>) {
  const r = await POST({
    request: new Request('http://localhost/api/admin/client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64'),
      },
      body: JSON.stringify(body),
    }),
  } as any);
  return { status: r.status, o: await r.json().catch(() => null) };
}

// Lo que manda el panel cuando ella NO toca el campo del envío (el caso de todos los días).
const fichaSinEnvio = { id: 7, business_name: 'Chungo Pilar', client_contact: '11', delivery_address: 'Pilar',
  notes: '', cuit: '30000000015', catalog: 'chungo', active: true, access_code: 'NUEVA' };

// ---------------------------------------------------------------------------
seccion('DESPUÉS del SQL — el campo funciona');

sembrar({ conColumna: true });
let r = await guardar(fichaSinEnvio);
ok(r.status === 200 && r.o?.ok, 'guardar sin tocar el envío: ok');
// Ojo con lo que esto prueba: que el SERVIDOR no agrega la columna si no vino en el cuerpo. Que el
// panel no la mande si ella no tocó el campo lo garantiza `data-orig` en el script del panel, que
// ningún arnés ejecuta: eso se verificó en el navegador (commit 0b64697 y el de la auditoría).
ok(!('envio_min' in (patches()[0]?.cuerpo || {})), '  ...y el servidor no agrega la columna si no vino en el cuerpo');
ok(cuenta().access_code === 'NUEVA', '  ...y la contraseña se guardó');

sembrar({ conColumna: true });
r = await guardar({ ...fichaSinEnvio, envio_min: '250.000' });
ok(r.status === 200 && cuenta().envio_min === 250000, "'250.000' se guarda como 250000");

sembrar({ conColumna: true });
cuenta().envio_min = 250000;
r = await guardar({ ...fichaSinEnvio, envio_min: '' });
ok(r.status === 200 && cuenta().envio_min === null, "'' vuelve a null (usa su lista), NO a 0");

sembrar({ conColumna: true });
r = await guardar({ ...fichaSinEnvio, envio_min: '0' });
ok(r.status === 200 && cuenta().envio_min === 0, "'0' se guarda como 0");
ok(/NUNCA paga el envío/.test(r.o?.warning || ''), '  ...y avisa que 0 es "nunca paga envío"');

for (const malo of ['1e5', '-5000', '250,5', 'abc', '250 mil']) {
  sembrar({ conColumna: true });
  r = await guardar({ ...fichaSinEnvio, envio_min: malo });
  ok(r.status === 400 && patches().length === 0 && cuenta().access_code === 'VIEJA',
    `'${malo}' → 400 y NO se guarda nada de la ficha`);
}

// ---------------------------------------------------------------------------
seccion('ANTES del SQL — nada de lo que ya andaba puede dejar de andar');

sembrar({ conColumna: false });
r = await guardar(fichaSinEnvio);
ok(r.status === 200 && r.o?.ok, 'guardar la ficha sin tocar el envío: ok (el caso de todos los días)');
ok(cuenta().access_code === 'NUEVA', '  ...la contraseña se guardó');
ok(patches().length === 1, '  ...con un solo PATCH');

sembrar({ conColumna: false });
r = await guardar({ ...fichaSinEnvio, envio_min: '250000' });
ok(r.status === 200 && r.o?.ok, 'tocando el envío sin la columna: se guarda igual el resto');
ok(cuenta().access_code === 'NUEVA', '  ...la contraseña se guardó');
ok(!('envio_min' in cuenta()), '  ...el envío NO (no hay dónde)');
ok(/MENOS el envío sin cargo/.test(r.o?.warning || ''), '  ...y lo dice: "se guardó todo MENOS el envío"');
ok(patches().length === 2, '  ...exactamente un reintento');

sembrar({ conColumna: false });
r = await guardar({ ...fichaSinEnvio, cuit: '30000000016', envio_min: '250000' });
ok(/verificador de AFIP/.test(r.o?.warning || '') && /MENOS el envío/.test(r.o?.warning || ''),
  'si además el CUIT no verifica, avisa LAS DOS cosas');

// ---------------------------------------------------------------------------
seccion('Cada causa con su mensaje (antes todo decía "¿el CUIT ya existe?")');

sembrar({ conColumna: true });
supa.fallar(/teia_clients/, 409, 1, '23505', 'PATCH');
r = await guardar({ ...fichaSinEnvio, envio_min: '250000' });
ok(supa.fallasDisparadas() === 1, 'el CUIT repetido se inyectó de verdad');
ok(r.status === 409 && /ya está en otra cuenta/.test(r.o?.error || ''), 'CUIT repetido → "ese CUIT ya está en otra cuenta"');
ok(patches().length === 1, '  ...y NO se reintentó sin el envío (no es un problema de columna)');

sembrar({ conColumna: true });
supa.fallar(/teia_clients/, 0, 1, undefined, 'PATCH');
r = await guardar(fichaSinEnvio);
ok(r.status === 503 && /no respondió/.test(r.o?.error || ''), 'base caída → 503 "la base no respondió"');

// ---------------------------------------------------------------------------
seccion('El alta de un comercio queda igual que siempre');

sembrar({ conColumna: false });
supa.tablas.teia_clients = [];
r = await guardar({ cuit: '30000000015', business_name: 'Nuevo', client_contact: '11', catalog: 'general', envio_min: '250000' });
const insert = supa.llamadas.find((l) => l.metodo === 'POST');
ok(r.status === 200 && r.o?.ok, 'alta sin la columna, aunque venga envio_min: ok');
ok(!!insert && !('envio_min' in (insert.cuerpo || {})), '  ...el INSERT no nombra la columna');

// ---------------------------------------------------------------------------
seccion('Dos dispositivos: una ficha vieja no pisa lo que se cambió desde el otro');
// Auditoría del 19/9: el panel mandaba la ficha ENTERA. Desde la compu (pantalla de la mañana),
// guardar un cambio de contacto devolvía a Pilar a la lista general y la volvía a habilitar.
sembrar({ conColumna: true });
cuenta().active = false; cuenta().catalog = 'chungo';          // el celular la dio de baja
r = await guardarViejo({ ...fichaSinEnvio, active: true, catalog: 'general' }); // JS viejo: la ficha entera
ok(r.status === 409 && /antes de la última actualización/.test(r.o?.error || ''), `panel VIEJO editando → 409 "recargá" (${r.status})`);
ok(cuenta().active === false && cuenta().catalog === 'chungo' && patches().length === 0, '  ...y no pisó nada: sigue de baja y en Chungo');
sembrar({ conColumna: true });
cuenta().active = false;
r = await guardar({ id: 7, client_contact: '11 5555-0000' }); // panel nuevo: solo lo que cambió
ok(r.status === 200 && cuenta().client_contact === '11 5555-0000' && cuenta().active === false && cuenta().access_code === 'VIEJA',
  'el panel nuevo cambia solo el contacto: no toca el estado ni la contraseña');
sembrar({ conColumna: true });
r = await guardar({ id: 7 });
ok(r.status === 200 && patches().length === 0, 'una edición sin campos: ok, sin mandarle un PATCH vacío a la base');
sembrar({ conColumna: true });
r = await guardarViejo({ cuit: '30000000058', business_name: 'Nuevo', client_contact: '11', catalog: 'general' });
ok(r.status === 200, 'dar de alta sin la marca sigue andando (no pisa nada)');

// ---------------------------------------------------------------------------
seccion('`esperado`: la ficha dice lo que MOSTRABA, y el servidor corta si la base ya es otra');
sembrar({ conColumna: true });
cuenta().access_code = 'NUEVA-DEL-CELU'; // el celular le cambió la contraseña
// La compu (pantalla de la mañana, mostraba VIEJA) toca "Enviar por WhatsApp": fuerza contraseña y CUIT.
r = await guardar({ id: 7, access_code: 'VIEJA', cuit: '30-00000001-5', esperado: { access_code: 'VIEJA', cuit: '30-00000001-5' } });
ok(r.status === 409 && /contraseña/.test(r.o?.error || '') && /vieja/.test(r.o?.error || ''), `pantalla vieja → 409 que nombra la contraseña: ${r.o?.error}`);
ok(cuenta().access_code === 'NUEVA-DEL-CELU' && patches().length === 0, '  ...y no la pisó (antes el WhatsApp le mandaba al comercio una contraseña que ya no existía)');
sembrar({ conColumna: true });
r = await guardar({ id: 7, access_code: 'VIEJA', cuit: '30-00000001-5', esperado: { access_code: 'VIEJA', cuit: '30-00000001-5' } });
ok(r.status === 200, 'con la pantalla al día (la base dice VIEJA y 30000000015) guarda');
sembrar({ conColumna: true });
cuenta().delivery_address = "O'Higgins 2345";
r = await guardar({ id: 7, client_contact: '11 2222', delivery_address: 'O Higgins 2345 PB', esperado: { delivery_address: 'O Higgins 2345' } });
ok(r.status === 200 && cuenta().delivery_address === 'O Higgins 2345 PB',
  "una dirección con apóstrofo (la pantalla la muestra sin él, por attrSafe) no se toma por cambiada");
sembrar({ conColumna: true });
cuenta().active = false;
r = await guardar({ id: 7, active: true, esperado: { active: true } }); // la pantalla la mostraba habilitada
ok(r.status === 409 && /estado/.test(r.o?.error || '') && cuenta().active === false, 'el estado: la pantalla la mostraba habilitada y el celular la dio de baja → 409');
sembrar({ conColumna: true });
supa.tablas.teia_clients = []; // la borraron desde el celular
r = await guardar({ id: 7, client_contact: '11', esperado: { client_contact: '11' } });
ok(r.status === 404 && /ya no existe/.test(r.o?.error || ''), `cuenta borrada desde otro lado → 404 (antes decía "guardado"): ${r.o?.error}`);
ok(r.o?.recargar === true, '  ...con recargar: el botón pasa a "Recargar" (en la app instalada no hay otra forma)');
sembrar({ conColumna: true });
cuenta().access_code = 'NUEVA-DEL-CELU';
r = await guardar({ id: 7, access_code: 'VIEJA', esperado: { access_code: 'VIEJA' } });
ok(r.status === 409 && r.o?.recargar === true, 'la pantalla vieja también manda recargar');
sembrar({ conColumna: true });
const disparadasAntes = supa.fallasDisparadas();
supa.fallar(/teia_clients/, 409, 1, '23505', 'PATCH');
r = await guardar({ id: 7, cuit: '30-00000002-3', esperado: { cuit: '30-00000001-5' } });
ok(supa.fallasDisparadas() === disparadasAntes + 1 && r.status === 409 && !r.o?.recargar,
  `pero un 409 que se arregla corrigiendo el dato (CUIT repetido) NO manda a recargar (${r.status}: ${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Mandar dos veces por WhatsApp sin recargar, con un apóstrofo');
// Verificación del 19/9: tras el primer WhatsApp, lo que "muestra" la pantalla es lo que viajó
// ("D'Angelo26", crudo), y el servidor lo comparaba contra attrSafe(base) = "D Angelo26" → 409 falso.
sembrar({ conColumna: true });
r = await guardar({ id: 7, access_code: "D'Angelo26", cuit: '30-00000001-5', esperado: { access_code: 'VIEJA', cuit: '30-00000001-5' } });
ok(r.status === 200 && cuenta().access_code === "D'Angelo26", 'el primer WhatsApp guarda la contraseña con apóstrofo');
r = await guardar({ id: 7, access_code: "D'Angelo26", cuit: '30-00000001-5', esperado: { access_code: "D'Angelo26", cuit: '30-00000001-5' } });
ok(r.status === 200, `el segundo, sin recargar, no es "pantalla vieja" (${r.status}: ${r.o?.error || 'ok'})`);
r = await guardar({ id: 7, business_name: "Panadería D'Angelo", esperado: { business_name: 'Chungo Pilar' } });
r = await guardar({ id: 7, business_name: "Panadería D'Angelo 2", esperado: { business_name: "Panadería D'Angelo" } });
ok(r.status === 200, `lo mismo con el nombre (${r.status}: ${r.o?.error || 'ok'})`);

// ---------------------------------------------------------------------------
seccion('El envío propio también lleva lo que la pantalla mostraba');
sembrar({ conColumna: true });
cuenta().envio_min = 250000; // se cargó desde el celular
r = await guardar({ id: 7, envio_min: '200000', esperado: { envio_min: '' } }); // la compu lo mostraba vacío
ok(r.status === 409 && /envío sin cargo/.test(r.o?.error || '') && cuenta().envio_min === 250000,
  `pantalla vieja → 409 que nombra el envío, y no lo pisa (antes guardaba 200000 en silencio): ${r.o?.error}`);
r = await guardar({ id: 7, envio_min: '200.000', esperado: { envio_min: '250000' } });
ok(r.status === 200 && cuenta().envio_min === 200000, 'con la pantalla al día, guarda');
r = await guardar({ id: 7, envio_min: '', esperado: { envio_min: '200000' } });
ok(r.status === 200 && cuenta().envio_min === null, '  ...y vaciarlo también');
sembrar({ conColumna: false });
r = await guardar({ id: 7, business_name: 'Chungo Pilar Norte', envio_min: '250000', esperado: { business_name: 'Chungo Pilar', envio_min: '' } });
ok(r.status === 200 && cuenta().business_name === 'Chungo Pilar Norte' && /MENOS el envío/.test(r.o?.warning || ''),
  `SIN la columna: no se puede comparar, y el resto se guarda como siempre (${r.status}: ${r.o?.warning || r.o?.error})`);

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
desinstalar();
process.exit(fallas ? 1 : 0);
