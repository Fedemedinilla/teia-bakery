// CUIT: la identidad de las cuentas mayoristas. Se guarda normalizado (solo dígitos) y se
// valida con el dígito verificador real (mod-11 de AFIP) — un typo no crea cuenta fantasma.

export function normCuit(s: any): string {
  return String(s ?? '').replace(/\D/g, '');
}

// Forma mínima aceptable: 11 dígitos. Es lo ÚNICO que se exige para entrar o para dar de alta.
// El verificador (isValidCuit) se usa solo para AVISAR de un posible tipeo — nunca para
// bloquear: quien decide si un CUIT es de un cliente real es Teia, no un algoritmo.
export function hasCuitShape(s: any): boolean {
  return normCuit(s).length === 11;
}

export function isValidCuit(s: any): boolean {
  const d = normCuit(s);
  if (d.length !== 11) return false;
  const W = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = W.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  const r = sum % 11;
  const ver = r === 0 ? 0 : 11 - r; // 11-r; r=1 daría 10 → inválido salvo la regla del 9
  const expected = ver === 10 ? 9 : ver;
  return expected === Number(d[10]);
}

// "20111111112" → "20-11111111-2" (solo para mostrar; en la DB va normalizado)
export function fmtCuit(s: any): string {
  const d = normCuit(s);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(s ?? '');
}
