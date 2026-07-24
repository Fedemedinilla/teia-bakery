// Por qué "no me deja cargar ningún CUIT": el último dígito es un verificador calculado.
// Para un prefijo dado hay UN solo dígito final válido — inventar el número falla 10 de 11 veces.
const W = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const verificador = (d: string) => {
  const r = W.reduce((a, w, i) => a + w * Number(d[i]), 0) % 11;
  const v = r === 0 ? 0 : 11 - r;
  return v === 10 ? 9 : v;
};

const base = '3012345678';
console.log(`Prefijo 30-12345678-? → el único dígito válido es: ${verificador(base)}`);
console.log('\nLos que se intentaron en la meet:');
for (const d of ['9', '2', '6', '0', '1']) {
  console.log(`  30-12345678-${d} → ${verificador(base) === Number(d) ? 'VÁLIDO' : 'rechazado (correctamente)'}`);
}
console.log('\nProbabilidad de que un CUIT inventado al azar pase: 1 de 11 (~9%).');
console.log('Conclusión: el validador funciona bien; lo que estaba mal era BLOQUEAR en vez de avisar.');
