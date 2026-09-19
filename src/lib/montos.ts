// Lector de los montos que escribe la administradora (saldo anterior y costo de envío del remito).
// Sin dependencias a propósito: lo importan el servidor (order.ts, confirm.ts) y el script del
// panel, que así calcula el "Total final" con EXACTAMENTE el mismo criterio que el remito.
//
// Tres respuestas, no dos:
//   · un número  → se guarda;
//   · null       → el campo quedó vacío: el remito dibuja el renglón en blanco para completar a mano;
//   · undefined  → no se entiende: el que llama lo rechaza y le pide que lo vuelva a escribir.
//
// El lector anterior sacaba todo lo que no fuera dígito, coma o punto y después borraba TODOS los
// puntos, así que guardaba en silencio montos que ella no escribió: "8 mil" → $8, "8000.50" →
// $800.050, "1e4" → $14, "8,000" → $8 (auditoría del 19/9). Ahora:
//   · el punto vale SOLO como separador de miles bien formado (grupos de tres: 8.000, 1.250.000);
//   · los decimales van con COMA, uno o dos (8.000,50);
//   · un "$" opcional, y el ".-" / ",-" de los precios redondos ("$ 8.000.-");
//   · el signo menos SOLO donde tiene sentido: el saldo puede ser a favor del comercio, el costo de
//     envío no (un "-8000" en el envío le descontaba el flete al total del remito);
//   · cualquier otra cosa —letras, un punto decimal, espacios entre los dígitos— se rechaza. Lo que
//     tiene dos lecturas posibles ("8.5": ¿ocho y medio u ochenta y cinco?) no se adivina.
// scripts/test-montos.ts compara este lector con el anterior, entrada por entrada.

const TOPE = 99_999_999;
const FORMA = /^([-−]?)\s*\$?\s*([-−]?)\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2})|[.,]-)?$/;

export type OpcionesMonto = {
  /** ¿Se acepta un monto negativo? true para el saldo (a favor del comercio), false para el envío. */
  negativo?: boolean;
};

const aCentavos = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

export function montoEscrito(v: unknown, { negativo = true }: OpcionesMonto = {}): number | null | undefined {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(v) > TOPE) return undefined;
    if (v < 0 && !negativo) return undefined;
    return aCentavos(v);
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(FORMA);
  if (!m) return undefined;
  const [, signo1, signo2, entero, decimales] = m;
  if (signo1 && signo2) return undefined; // "--5", "-$-5"
  const n = Number(entero.replace(/\./g, '') + (decimales ? '.' + decimales : ''));
  if (!Number.isFinite(n) || n > TOPE) return undefined;
  const conSigno = signo1 || signo2 ? -n : n;
  if (conSigno < 0 && !negativo) return undefined;
  return aCentavos(conSigno);
}

/** Por qué no se entiende un monto, dicho para ella (solo tiene sentido si montoEscrito dio undefined). */
export function porQueNoSeEntiende(v: unknown, { negativo = true }: OpcionesMonto = {}): string {
  const s = String(v ?? '').trim();
  const m = s.match(FORMA);
  if (m) {
    // Dos signos ("--3000", "-$-3000"): la forma los deja pasar y montoEscrito los rechaza. Sin este
    // caso el motivo caía en "es demasiado grande", que la mandaba a buscar el error donde no estaba.
    if (m[1] && m[2]) return 'tiene dos signos menos: dejá uno solo';
    // La forma está bien: lo que falla es el valor.
    if ((m[1] || m[2]) && !negativo) return 'no puede ser negativo';
    return 'es demasiado grande';
  }
  if (typeof v === 'number') return !negativo && v < 0 ? 'no puede ser negativo' : 'es demasiado grande';
  if (/[a-zñáéíóú]/i.test(s)) return 'va en números, sin letras ni palabras ("8 mil" se escribe 8000)';
  if (/\d\.\d{1,2}$/.test(s) || /\d\.\d{4,}/.test(s)) return 'tiene los centavos con punto, y van con coma (8.000,50)';
  return 'no se entiende: escribilo como 8000, 8.000 o 8.000,50 (los centavos, con coma)';
}

/** Cómo se muestra en el campo un monto guardado, para que al volver a leerlo dé lo mismo:
 *  entero sin separadores ("8000") y con centavos, coma decimal ("8000,50"). Antes se mostraba con
 *  String(n): 8000,50 aparecía "8000.5", y el punto se leía como miles (80005). */
export function montoParaCampo(v: unknown): string {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v); // ilegible: que se vea tal cual, no que desaparezca
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}
