# Teia Bakery — Bucketlist

App de pedidos mayorista (B2B). Live: **teia-bakery.vercel.app** · Repo: `Fedemedinilla/teia-bakery`
Stack: Astro 5 + Supabase (proyecto DEMOS, tablas `teia_`) + Vercel. Es el **template e-commerce** de KyndredAI.

> Lista canónica de tareas — se lee/actualiza cada sesión.

---

## ✅ Hecho (el grueso de la app)
- **/catalogo** — fusión "anti-Tiendanube": carta por rubros + steppers en línea + panel de pedido en vivo con medidor de mínimo + recompra + fotos; responsive.
- **/pedido** — checkout (el cliente ya NO pone fecha de entrega; la confirma Mica).
- **/administradora** (con clave):
  - **Pedidos** — tarjetas con el detalle de ítems + "Editar pedido" (todos los datos + cantidades) + Confirmar (descuenta stock).
  - **Productos** — lista + Editar + Borrar + badges de stock.
  - **Nuevo producto** — form compacto + vista previa en vivo + subida de imagen (a Storage) + rubro como dropdown + Visible.
  - **Rubros** — crear/borrar categorías.
  - Navegación admin ↔ catálogo.
- Stock (descuento al confirmar + aviso de poco stock).
- Modo demo (sin Supabase muestra datos de ejemplo).

## 🔴 Falta para el MVP (lo que lo hace entregable)
Lo core que reemplaza el trabajo manual de Mica:
1. **Service account de Google** — *(Federico)* prerequisito de lo de abajo. **← próximo paso.**
2. **Archivador de remitos** — al Confirmar → genera el remito PDF (pdf-lib) → lo sube a **Drive / carpeta "remitos"** (subcarpetas semanales). App-native (sin n8n).
3. **Espejo al Google Sheet** — TODO lo del panel (productos + pedidos) reflejado en el Sheet, **incluso borrados** (rebuild completo por cron).
4. **Confirmar SQL corridos en DEMOS**: bucket `teia-productos` (subida de fotos) + tabla `teia_categories` (dropdown de rubros).
5. **Test end-to-end**: pedido real → confirmar → ver descuento de stock + remito generado.

## 🟡 Para el go-live oficial (handoff a Teia)
- Mover de DEMOS a un **proyecto Supabase del cliente** (aislado, su cuenta).
- **Dominio** `app.teiabakery.com.ar`.
- **Keep-alive** para que el free tier de Supabase no pause la base.
- `MIN_ORDER` (hoy hardcodeado en 40000) → config de la tienda.
- Cargar los **links reales de Drive/Sheet** en el admin (hoy vacíos).
- **Precio** cerrado (~US$700 build + ~US$55/mes) + scope por escrito.
- **Testimonio** + permiso para mostrarlo en portfolio/LinkedIn.

## 🔵 Fase 2 (nice-to-have)
- **Resumen semanal con IA** (Claude lee la semana → producto top, total, clientes, % de cambios) — el gancho vendible.
- Estados **entregado / anulado** (anular reajusta stock).
- **Email** de aviso de poco stock (hoy solo se loguea).
- Auto-edición del cliente hasta 24h antes del envío (hoy lo edita Mica).
