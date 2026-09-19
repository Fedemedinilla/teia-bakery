// Escalón 2: las MISMAS afirmaciones que test-drive.ts, pero contra Google Drive DE VERDAD.
//
// Por qué hace falta: test-drive.ts prueba mi lógica contra un Drive que escribí yo. Si Google no
// se comporta como yo creo —el orden por createdTime, la búsqueda por appProperties, el filtro de
// papelera, la deduplicación por nombre dentro de una carpeta— la carpeta de impresión podría
// duplicarse en producción y la encargada del local quedaría mirando una carpeta que ya no recibe
// nada. Eso solo lo puede desmentir Google.
//
// Correr, desde teia-bakery/:
//   npx -y tsx scripts/test-drive-real.ts             ← SOLO MIRA. No escribe nada.
//   npx -y tsx scripts/test-drive-real.ts --escribir  ← crea y borra cosas en ESE Drive.
//
// ⚠️ Usa la cuenta de Google que esté en `.env.development.local`. Antes de escribir nada imprime
// lo que encuentra y frena: si aparecen nombres de comercios reales, estás apuntando al Drive de
// la clienta y hay que parar. Por eso la escritura está detrás de un flag.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Cargar `.env.development.local` a mano: no hay dotenv en el proyecto y tsx no lee .env solo.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const archivo of ['.env.development.local', '.env']) {
  try {
    for (const linea of readFileSync(join(raiz, archivo), 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const valor = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined && valor) process.env[m[1]] = valor;
    }
  } catch { /* el archivo puede no existir */ }
}

const ESCRIBIR = process.argv.includes('--escribir');
const { GOOGLE_OAUTH_CLIENT_ID: ID, GOOGLE_OAUTH_CLIENT_SECRET: SECRET, GOOGLE_OAUTH_REFRESH_TOKEN: REFRESH } = process.env;

if (!ID || !SECRET || !REFRESH) {
  console.error('\nFaltan GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN.');
  console.error('Van en teia-bakery/.env.development.local (ignorado por git).\n');
  process.exit(1);
}

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};

/** Token propio, para las dos operaciones que el test necesita y la app no expone. */
async function token(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: ID!, client_secret: SECRET!, refresh_token: REFRESH!, grant_type: 'refresh_token' }),
  });
  if (!r.ok) throw new Error(`no se pudo refrescar el token (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

/** Renombra un archivo/carpeta. Vive acá y no en `lib/`: es una necesidad del test, no del producto. */
async function renombrar(id: string, name: string): Promise<void> {
  const t = await token();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`no se pudo renombrar (${r.status})`);
}

const G = await import('../src/lib/google');

// ---------------------------------------------------------------------------
// FASE 1 — solo mirar. Siempre corre.
// ---------------------------------------------------------------------------
console.log('\n== Qué hay hoy en este Drive ==\n');

const estado = await G.googleStatus();
if (!estado.connected) {
  console.error('  No se pudo conectar. Revisá las credenciales, o el token ya venció: con la');
  console.error('  pantalla de consentimiento en "Testing", Google lo caduca a los 7 días.\n');
  process.exit(1);
}
console.log('  carpeta raíz  :', estado.driveUrl || '(no existe todavía)');
console.log('  planilla      :', estado.sheetUrl || '(no existe todavía)');
console.log('  para imprimir :', estado.printUrl || '(no existe todavía)');
if (estado.printCount !== undefined) console.log('  archivos adentro:', estado.printCount);
if (estado.printNames?.length) {
  console.log('\n  Lo que hay en la carpeta de impresión:');
  for (const n of estado.printNames.slice(0, 20)) console.log('   ·', n);
  if (estado.printNames.length > 20) console.log(`   … y ${estado.printNames.length - 20} más`);
}
if (estado.printDupes) console.log('\n  ⚠️ HAY MÁS DE UNA carpeta de impresión marcada.');
if (estado.printTrashed) console.log('\n  ⚠️ La carpeta de impresión está en la papelera.');
if (estado.printError) console.log('\n  ⚠️ No se pudo leer la carpeta de impresión.');

if (!ESCRIBIR) {
  console.log('\n──────────────────────────────────────────────────────────────────');
  console.log('  MIRÁ ESA LISTA ANTES DE SEGUIR.');
  console.log('  Si ahí hay nombres de comercios REALES, estás apuntando al Drive de la');
  console.log('  clienta: no corras el paso siguiente.');
  console.log('  Si está vacío o son cosas tuyas:');
  console.log('     npx -y tsx scripts/test-drive-real.ts --escribir');
  console.log('──────────────────────────────────────────────────────────────────\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// FASE 2 — escribir. Solo con --escribir.
// ---------------------------------------------------------------------------
console.log('\n== Las mismas afirmaciones del arnés, contra Google de verdad ==\n');

const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]); // "%PDF-1.4\n"
const pedidoDePrueba = {
  id: 999999,
  order_number: `PRUEBA-${process.pid}`,
  client_name: "Prueba Rivas' & Cía. ★",  // hostil a propósito: apóstrofo, ampersand, símbolo
  confirmed_at: '2026-09-07T18:00:00Z',
};
const nombre = G.printFileName(pedidoDePrueba);
console.log('  nombre de archivo:', JSON.stringify(nombre), '\n');

// 1. Encontrar-o-crear es idempotente contra Google real.
const a = await G.ensurePrintFolder();
const b = await G.ensurePrintFolder();
ok(a.id === b.id, 'dos llamadas seguidas devuelven la MISMA carpeta (no duplica)');
console.log('        ', a.url);

// 2. Subir dos veces el mismo remito deja UN archivo. Acá se prueba que la deduplicación por
//    nombre dentro de una carpeta funciona en Drive real, que es de lo que depende que reintentar
//    un archivado no le llene la carpeta de copias a la encargada.
await G.uploadPrintCopy(nombre, pdf);
await G.uploadPrintCopy(nombre, pdf);
const tras2 = await G.googleStatus();
const repetidos = (tras2.printNames || []).filter((n) => n === nombre).length;
ok(repetidos === 1, `subir dos veces deja UN solo archivo (encontró ${repetidos})`);

// 3. El nombre vuelve TAL CUAL. Es lo que hace que el ✓ del panel pueda compararlo: si Google
//    normalizara los acentos distinto, el tilde no se encendería nunca y nadie sabría por qué.
ok((tras2.printNames || []).includes(nombre), 'Google devuelve el nombre exactamente igual al que mandamos');

// 4. Renombrada a mano, se la sigue encontrando por la MARCA. Es el invariante del que depende
//    que la carpeta compartida con el local no quede huérfana.
const original = 'Remitos para imprimir';
await renombrar(a.id, 'IMPRIMIR (prueba)');
const trasRenombre = await G.ensurePrintFolder();
ok(trasRenombre.id === a.id, 'renombrada a mano, la sigue encontrando por la marca (appProperties)');
await renombrar(a.id, original);

console.log('\n── limpieza ──');
ok(await G.trashPrintCopy(nombre), 'el archivo de prueba se mandó a la papelera');
console.log('  La carpeta "Remitos para imprimir" queda creada en este Drive. Si es tu cuenta de');
console.log('  pruebas, borrala a mano cuando quieras; si la dejás, no molesta.');

console.log(`\n${fallas === 0 ? 'TODO OK contra Google real' : `${fallas} FALLAS contra Google real`}\n`);
process.exit(fallas ? 1 : 0);
