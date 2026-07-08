# Teia Bakery — Bucketlist

App de pedidos mayorista (B2B). Live: **teia-bakery.vercel.app** · Repo: `Fedemedinilla/teia-bakery`
Stack: Astro 5 + Supabase (proyecto DEMOS, tablas `teia_`) + Vercel. Es el **template e-commerce** de KyndredAI.

> Lista canónica de tareas — se lee/actualiza cada sesión. Última reconciliación: **2026-07-08**.

---

## ✅ Hecho (el grueso de la app)
- **/catalogo** — fusión "anti-Tiendanube": carta por rubros + "Agregar"→stepper + panel de pedido en vivo
  (medidor de mínimo) + modal de detalle de producto + recompra (localStorage **+ búsqueda por WhatsApp
  cross-device** vía `/api/last-order`) + scroll-spy + Lenis smooth scroll.
- **/pedido** — checkout rediseñado (bible UX/UI): 2 columnas, resumen sticky editable, validación amable,
  estados vacío/éxito pulidos. El cliente NO pone fecha de entrega (la confirma Mica por WhatsApp).
- **/administradora** (con clave):
  - **Pedidos** — tarjetas con detalle + Editar pedido (datos + cantidades) + Confirmar + Borrar +
    **toggle "Descuento fiel −10%"** (manual, decide Mica) + estado de archivado (✓ links a los 2 PDF / ⚠️ Reintentar).
  - **Productos** — lista + Editar + Borrar + badges de stock; **mobile = tarjetas verticales** (sin scroll horizontal).
  - **Nuevo producto** — form + vista previa en vivo + subida de imagen + rubro dropdown + Visible.
  - **Rubros** — crear/borrar categorías.
- **Archivador de remitos (app-native, sin n8n)** — al Confirmar: genera **2 PDF** (cliente + interno con
  checkboxes) con pdf-lib → **Supabase Storage** (bucket `teia-remitos`; NO Drive: una service account no
  tiene cuota en Gmail) → URLs + `archive_status` en el pedido. Reintento 3×, idempotente (HMAC path),
  nunca bloquea el confirm; botón Reintentar en el panel.
- Stock (descuento al confirmar + aviso de poco stock). Modo demo. Auditoría de código/seguridad
  (caps en /api/order, escape XSS, headers en vercel.json) + auditoría de diseño (micro-interacciones).
- **Barrido nocturno + keep-alive** (2026-07-08) — Vercel cron diario (03:00 AR) → `/api/cron/sweep`:
  reintenta archivados en error o que nunca corrieron (cap 5/corrida); la consulta a la base hace de
  keep-alive del free tier. Auth: exige `CRON_SECRET` (timing-safe) si está seteada; admin también puede.
- **`MIN_ORDER` configurable** (2026-07-08) — env `TEIA_MIN_ORDER` en Vercel (default 40000).
- **`schema.sql` completado** (2026-07-08) — ahora incluye `discount_pct`, columnas `archive_*`,
  URLs de remitos y el bucket `teia-remitos` (+ sección de migración para bases existentes);
  antes esos SQL solo se habían corrido a mano en DEMOS y el handoff al cliente los perdía.

## 🔴 Falta para el MVP (lo que lo hace entregable)
1. **Service account de Google** — *(Federico; pasos ya entregados)* prerequisito del Sheet. **← bloqueante.**
2. **SQL `discount_pct`** — *(Federico, 1 línea)* `alter table teia_orders add column if not exists discount_pct int not null default 0;` — sin esto el toggle de descuento no persiste en prod.
3. **Espejo al Google Sheet** — pedidos + productos reflejados (incluso borrados; rebuild por cron) con
   columna de links a los remitos. *(Necesita 1.)*
4. ~~Barrido nocturno~~ — **HECHO 2026-07-08** (`/api/cron/sweep`, ver arriba); falta verlo correr en prod.
5. **Test end-to-end en prod**: pedido → confirmar → 2 PDF + fila en Sheet + descuento fiel en remito.

## 🟡 Para el go-live oficial (handoff a Teia)
- Mover de DEMOS a un **proyecto Supabase del cliente** (aislado, su cuenta).
- **Dominio** `app.teiabakery.com.ar`.
- ~~Keep-alive~~ — **HECHO 2026-07-08**: lo cubre el mismo cron del barrido (consulta diaria a la base).
- ~~MIN_ORDER~~ — **HECHO 2026-07-08**: env `TEIA_MIN_ORDER` (default 40000); cambiarlo = editar la env en Vercel + redeploy.
- **Env vars nuevas para Federico**: `CRON_SECRET` (recomendada, cualquier string largo) y
  `TEIA_MIN_ORDER` (opcional) en Vercel.
- Cargar el **link real del Sheet** en el admin (hoy vacío; el botón Drive quedó legacy → decidir si se saca).
- **Precio** cerrado (US$700 build + US$55/mes; propuesta PDF sobria ya entregada) + scope por escrito.
- **Testimonio** + permiso para mostrarlo en portfolio/LinkedIn/IG.

## 🔵 Fase 2 (nice-to-have)
- **Resumen semanal con IA** (código calcula números exactos desde la DB → Claude redacta el informe) — el gancho vendible.
- Lista de **clientes fieles** que pre-tilda el descuento −10% (match por teléfono; Mica siempre confirma).
- Estados **entregado / anulado** (anular reajusta stock).
- **Email** de aviso de poco stock + email de alerta cuando un archivado falla 3× (hoy solo estado en panel).
- Auto-edición del cliente hasta 24h antes del envío (hoy lo edita Mica).
- Endurecer `/api/last-order` si hiciera falta (hoy: cualquiera con un teléfono ve el último pedido de ese teléfono — baja sensibilidad, decisión consciente).
