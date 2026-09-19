// El panel de la administradora que sabe mandar SOLO lo que ella cambió (v1.2) se identifica con
// `panel: 2` en el cuerpo de cada POST.
//
// Por qué hace falta: un panel abierto ANTES del deploy sigue corriendo el JS viejo hasta que se
// recarga (en la app instalada del celular puede quedar abierto días). Ese JS manda SIEMPRE el
// costo de envío, el saldo y los montos de todas las listas, con lo que su pantalla mostraba al
// cargarse. Desde una pantalla vieja eso pisa lo que se guardó después desde el otro dispositivo:
// confirmar le borraba (o le volvía a poner) el envío al remito, y guardar Envíos devolvía la lista
// Chungo a $250.000. Primero se ignoraban solo los montos vacíos; no alcanzaba, porque un monto
// viejo NO vacío pisa igual (auditoría del 19/9). Ahora, todo lo que toque plata sin la marca se
// rechaza sin escribir nada, y el panel viejo muestra este mensaje.

export const PANEL_VIEJO =
  'Esta pantalla es de antes de la última actualización de la app. No se guardó nada: recargá la página (en el celular, cerrá la app y volvé a abrirla) y volvé a hacer el cambio.';

/** ¿El cuerpo viene del panel nuevo? */
export function esPanelNuevo(b: any): boolean {
  return !!b && b.panel === 2;
}
