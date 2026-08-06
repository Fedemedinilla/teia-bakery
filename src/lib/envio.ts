// El umbral de ENVÍO SIN CARGO de cada lista.
//
// Antes esto era el "pedido mínimo": si no llegabas, no podías confirmar. Eso no era lo que
// pasa en la realidad de Teia. Palabras de la clienta: "el mínimo para lista general es
// $140.000 sino se cobra envío", y "por lo general hacen pedido para llevar al mínimo".
// O sea: el número no impide comprar, decide quién paga el flete. Bloquear el pedido le hacía
// perder ventas que ella igual habría aceptado cobrando el envío aparte.
//
// El costo del envío NO vive acá: varía por zona y lo carga ella al confirmar, en el remito.
import { CATALOGS, catalogOf } from './catalogs';
import { numeroDe, type Ajustes } from './settings';

/** Valores por defecto: los que dio la clienta. Se usan hasta que corra el SQL de teia_settings,
 *  y como red de seguridad si esa consulta falla. A partir de ahí manda lo que ella cargue. */
const POR_DEFECTO: Record<string, number> = {
  general: 140000,
  chungo: 250000, // Chungo (Pilar): siempre con envío, nunca retira
};

/** La clave se arma desde la lista CERRADA de catálogos: nada arbitrario entra a la tabla. */
export function claveUmbral(catalog: string): string {
  return 'envio_min_' + catalogOf(catalog);
}

export function umbralDe(ajustes: Ajustes, catalog: string): number {
  const slug = catalogOf(catalog);
  return numeroDe(ajustes, claveUmbral(slug), POR_DEFECTO[slug] ?? POR_DEFECTO.general);
}

/** Todos los umbrales, para pintar la pestaña del panel. */
export function umbralesTodos(ajustes: Ajustes): { slug: string; label: string; monto: number }[] {
  return CATALOGS.map((c) => ({ slug: c.slug, label: c.label, monto: umbralDe(ajustes, c.slug) }));
}

export const claveUmbralValida = (k: string) => CATALOGS.some((c) => claveUmbral(c.slug) === k);
