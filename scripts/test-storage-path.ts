// Diff de `storagePath` contra la línea que reemplaza, sobre un corpus.
// Correr:  npx -y tsx scripts/test-storage-path.ts
//
// Por qué existe: `storagePath` sale de factorizar dos líneas que hoy funcionan en producción y
// deciden QUÉ PDF se le sirve a la administradora. "Los tests pasan" no prueba que no moviste
// nada — lo único que lo prueba es correr la versión vieja y la nueva lado a lado y diffear.
import { storagePath } from '../src/lib/supabase';

// La lógica EXACTA de src/pages/api/admin/remito.ts antes del cambio.
function viejo(stored: string): string {
  const marker = '/teia-remitos/';
  return stored.includes(marker) ? stored.slice(stored.indexOf(marker) + marker.length).split('?')[0] : stored;
}

const CORPUS: string[] = [
  // lo que se guarda hoy: el path pelado
  'remito-28-a1b2c3d4e5f6a7b8-cliente-v1.pdf',
  'remito-1-0000000000000000-cliente-v12.pdf',
  // remitos viejos: URL pública entera
  'https://xxx.supabase.co/storage/v1/object/public/teia-remitos/remito-9-abc-cliente-v1.pdf',
  // con querystring de token
  'https://xxx.supabase.co/storage/v1/object/sign/teia-remitos/remito-9-abc-cliente-v1.pdf?token=eyJhbGciOi',
  // el marcador aparece en el medio de un nombre (caso raro pero posible)
  'carpeta/teia-remitos/adentro/remito-3-x-cliente-v1.pdf',
  // el marcador aparece DOS veces: ambos tienen que cortar en el primero
  'https://x/teia-remitos/teia-remitos/remito-4-y-cliente-v1.pdf',
  // vacío (el endpoint lo corta antes con un 404, pero que no diverja)
  '',
  // sin el marcador pero con querystring
  'remito-5-z-cliente-v1.pdf?x=1',
  // nombre con espacios y acentos
  'remito-6-ñ-cliente-v1 copia.pdf',
];

let fallas = 0;
console.log('\nentrada -> salida (vieja | nueva)\n');
for (const s of CORPUS) {
  const a = viejo(s);
  const b = storagePath(s);
  const igual = a === b;
  if (!igual) fallas++;
  console.log(`${igual ? '  ok  ' : ' DIFF '} ${JSON.stringify(s).slice(0, 62)}`);
  console.log(`        -> ${JSON.stringify(a)}`);
  if (!igual) console.log(`        -> ${JSON.stringify(b)}  <-- LA NUEVA DIFIERE`);
}

// El único caso donde difieren a propósito: la vieja LANZA con null/undefined, la nueva devuelve ''.
// En el endpoint eso es inalcanzable (hay un `if (!stored) return 404` antes), pero el endpoint
// nuevo también lo va a llamar, así que conviene que no explote.
let lanzo = false;
try { viejo(null as any); } catch { lanzo = true; }
console.log(`\n  ok   con null la vieja ${lanzo ? 'LANZA' : 'no lanza'} y la nueva devuelve ${JSON.stringify(storagePath(null as any))} (divergencia deliberada, inalcanzable en el endpoint)`);

console.log(`\n${fallas === 0 ? `IDÉNTICAS en los ${CORPUS.length} casos` : `${fallas} DIVERGENCIAS`}\n`);
process.exit(fallas ? 1 : 0);
