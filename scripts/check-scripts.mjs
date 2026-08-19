// Valida la SINTAXIS de los <script> que viven adentro de los .astro.
//
// Existe por un agujero real: `astro check` y `npm run build` NO parsean esos bloques. Un string
// sin cerrar en el script del panel compila, deploya, y recién se descubre cuando la
// administradora abre la página y NADA funciona: ni guardar un pedido, ni confirmar, ni el globo.
// Ya se rompió así dos veces editando el archivo con scripts.
//
// Correr con: npm run check:js   (va incluido en npm run check)
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// fileURLToPath y no .pathname: en Windows una ruta con espacios llega como "CLAUDE%20CODE"
// y readdirSync no la encuentra.
const raiz = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'teia-astro-'));

function astroFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...astroFiles(p));
    else if (e.endsWith('.astro')) out.push(p);
  }
  return out;
}

/** Valida la sintaxis SIN ejecutar nada. Devuelve el mensaje de error, o null si está bien. */
function revisar(codigo, n) {
  // Los bloques con import/export son módulos: `new Function` no los sabe leer y daría un falso
  // positivo. Para esos se usa el parser de verdad de Node sobre un .mjs temporal.
  if (/^\s*(import|export)\s/m.test(codigo)) {
    const f = join(tmp, 'bloque' + n + '.mjs');
    writeFileSync(f, codigo, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      return null;
    } catch (e) {
      const salida = String(e.stderr || e.message);
      return salida.split(/\r?\n/).find((l) => /Error/.test(l)) || 'error de sintaxis';
    }
  }
  try { new Function(codigo); return null; } catch (e) { return e.message; }
}

let fallos = 0, bloques = 0;
for (const archivo of astroFiles(join(raiz, 'src'))) {
  const texto = readFileSync(archivo, 'utf8');
  // Solo los scripts del navegador: los que tienen src= o un type= no se parsean acá.
  for (const m of texto.matchAll(/<script(?![^>]*\b(?:src|type=)[^>]*)>([\s\S]*?)<\/script>/g)) {
    bloques++;
    const error = revisar(m[1], bloques);
    if (error) {
      fallos++;
      const linea = texto.slice(0, m.index).split('\n').length;
      console.error('x ' + relative(raiz, archivo) + ':~' + linea + ' - ' + error);
    }
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(bloques + ' bloques <script> revisados en .astro - ' + fallos + ' con error de sintaxis');
process.exit(fallos ? 1 : 0);
