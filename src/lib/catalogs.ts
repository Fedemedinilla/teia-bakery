// Las LISTAS del gate privado. Mismo patrón que los roles del Bayard: un valor de texto
// acotado, y la administradora elige a cuál pertenece cada cuenta al darla de alta.
//   · (sin cuenta)  → no entra a ningún lado
//   · 'general'     → catálogo mayorista de siempre
//   · 'chungo'      → catálogo VIP de Chungo (una franquicia: muchos locales, un catálogo)
export const CATALOGS = [
  { slug: 'general', label: 'Mayorista general' },
  { slug: 'chungo', label: 'Chungo (VIP)' },
];

export const DEFAULT_CATALOG = 'general';

export function isCatalog(s: any): boolean {
  return CATALOGS.some((c) => c.slug === s);
}

export function catalogOf(s: any): string {
  return isCatalog(s) ? String(s) : DEFAULT_CATALOG;
}

export function catalogLabel(s: any): string {
  return CATALOGS.find((c) => c.slug === s)?.label || CATALOGS[0].label;
}
