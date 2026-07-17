# Teia Bakery — Bucketlist

App de pedidos mayorista (B2B). Live: **teia-bakery.vercel.app** · Repo: `Fedemedinilla/teia-bakery`
Stack: Astro 5 + Supabase (proyecto DEMOS, tablas `teia_`) + Vercel. Es el **template e-commerce** de KyndredAI.

> Lista canónica de tareas — se lee/actualiza cada sesión. Última reconciliación: **2026-07-08**.

---

## ✅ Hecho (el grueso de la app)
- **/catalogo** — fusión "anti-Tiendanube": carta por rubros + "Agregar"→stepper + panel de pedido en vivo
  (medidor de mínimo) + modal de detalle de producto + recompra ~~por WhatsApp~~ → **por cuenta CUIT**
  (2026-07-17) + scroll-spy + Lenis smooth scroll.
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
3. ~~Espejo Google Sheet + Drive~~ — **CONSTRUIDO 2026-07-17** (falta conectar la cuenta): OAuth
   `drive.file` con la cuenta real (NO service account). `lib/google.ts` REST puro: Drive
   `Remitos Teia/año/mes - Mes/comercio/` con PDFs de nombre legible (idempotente, mismo retry
   del archivador) + Sheet espejo AUTO-CREADO con 5 pestañas (Pedidos con links a remitos,
   Ítems, Productos, Clientes, Resumen con totales por mes/año/cliente/producto — cubre el
   pedido de históricos de Mica). REBUILD completo desde la base en cada cambio (confirmar,
   editar, borrar, reintentar, producto) + rebuild nocturno en el sweep. TRANSPORTABLE: 3 env
   vars; carpeta y planilla se auto-crean (marcadas con appProperties, cero IDs hardcodeados)
   → handoff a la clienta = re-consentir con SU cuenta y pegar el token nuevo. Botón "Conectar
   Google" en el panel (start/callback muestran el refresh token una vez) + botones Drive/
   Planilla dinámicos según el estado real. **Pendiente: checklist GCP de Federico + conectar.**
4. ~~Barrido nocturno~~ — **HECHO 2026-07-08** (`/api/cron/sweep`, ver arriba); falta verlo correr en prod.
5. ~~Test end-to-end en prod~~ — **HECHO 2026-07-17** (flujo cuentas CUIT completo): pedido hostil →
   cuenta auto-creada → Mica activa descuento en Clientes → 2º pedido llega con −10% server-side
   (verificado por API: total 43200/48000) → confirmar → 2 PDFs verificados con parser (desglose
   Subtotal/Descuento/Total exacto, emoji filtrados, UTF-8 intacto) → borrar repone stock → cuenta
   borrada. Falta solo la "fila en Sheet" (el espejo aún no existe — ver OAuth).

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

## ✅ CUENTAS POR CUIT — CONSTRUIDO 2026-07-17 (decisión de Federico; reemplaza el plan de tokens)
- **Identidad = CUIT** (validado con dígito verificador mod-11 real, `src/lib/cuit.ts` + test con
  CUITs públicos). Tabla `teia_clients` + `teia_orders.client_id` (FK on delete set null).
- **Cliente:** catálogo público; "Ingresá con tu CUIT" arriba → banner con su comercio + recompra
  del server (cross-device). **Checkout: CUIT OBLIGATORIO**, autocompleta datos de la cuenta;
  cuenta nueva se crea sola con el primer pedido. CUIT recordado en el dispositivo.
- **Descuento fiel POR CLIENTE:** Mica lo prende en la pestaña **Clientes**; el cliente identificado
  ve TODO el catálogo con precio de lista tachado + precio neto (pedido de Federico: "aire de
  cliente de confianza"). El % lo aplica SOLO el server al crear la orden (nunca viaja del browser)
  y queda snapshoteado en la orden. Mínimo $40k se evalúa sobre precio de LISTA. El toggle por
  pedido sigue como override de Mica.
- **Panel /administradora → pestaña Clientes:** CUIT = comercio, badges (fiel −10%, nº pedidos),
  detalle editable (datos + notas internas + descuento) + **historial de pedidos de ese CUIT** con
  links a remitos + alta manual opcional. Deep-link `#clientes`.
- **Rollback ejecutado (sin código muerto):** borrados `/api/last-order.ts`, el buscador por
  WhatsApp del catálogo y `teia_last_order` (localStorage). El fix de email del Pack 2 quedó
  superado por esto.
- **⚠️ SQL requerido en DEMOS para que el checkout funcione en prod** (sin la tabla, /api/order
  responde 503): sección `teia_clients` + `client_id` de `supabase/schema.sql`.
- Endpoints nuevos: `/api/client` (público, lookup por CUIT — expone datos del propio comercio,
  decisión consciente igual que el last-order que reemplaza) y `/api/admin/client`.
- Verificado en demo: API 4 casos, strikethrough, banner, recompra neta, checkout autofill +
  total neto + envío, pestaña Clientes con historial.

## 📩 Pedidos de Mica (WhatsApp 2026-07-06) — estado
1. **Dos listas de precios** (Chungo vs. general) — ⚠️ ABIERTO: el descuento por cliente cubre
   "precios especiales" como %, pero si Chungo necesita PRECIOS por producto distintos, falta
   `price_list` por cliente + segundo precio (definir en el Meet). El esquema ya lo soporta.
2. ~~Datos pre-cargados~~ — **HECHO** con las cuentas CUIT (arriba).
3. **Drive por mes/año — CONFIRMADO por la clienta (2026-07-16); SÍ es posible.** El descarte
   anterior era del camino service account (los archivos quedan a nombre de la SA, que no tiene
   cuota en Gmail). **Ruta propuesta (pendiente de ok de Federico): OAuth con la cuenta de Mica,
   scope `drive.file`** — ella autoriza una vez, refresh token en Vercel, los remitos van a SU
   Drive (`Remitos/2026/Julio/<cliente>/…`) con su cuota. Bonus: si la app crea el Sheet espejo,
   `drive.file` también cubre la Sheets API → **la service account deja de hacer falta** (adiós
   tarea bloqueante 1 del MVP). Se puede probar YA con el Gmail de Federico y cambiar el token
   en el handoff. Supabase Storage sigue como archivo maestro; Drive es espejo dentro de
   `archiveOrder` (mismo retry + barrido). Plan B: puente Apps Script en su cuenta. Si ella ya
   tuviera Workspace (¿mail @teiabakery.com.ar?), existe la ruta unidad compartida + SA.
4. **Histórico por producto/cliente + totales mensuales/anuales** — pestañas con fórmulas en el
   mismo Sheet espejo (se arma una vez, sin mantenimiento). El informe redactado con IA sigue en Fase 2.
5. **Cuentas armadas por Federico** (Vercel/Supabase) — ya era el plan del handoff; decidir si a
   nombre de ella o hosting bajo KyndredAI dentro del mensual (ver checklist de handoff).
6. **Guía de uso** no técnica (cambiar precios, productos, confirmar pedidos) + llamada corta.

## 🔧 Auditoría de código (2026-07-16) — fixes pendientes
Auditoría multi-agente (7 lentes + jueces adversariales): 60 hallazgos crudos → 30 confirmados leyendo el código. Ningún crítico; 5 rompen operación real.

**Pack 1 — ALTA — ✅ ARREGLADO 2026-07-17** (commit con harness `scripts/test-remito.ts`: caso hostil
crasheaba con el código viejo y pasa con el fix; falta verlo en prod tras el push):
1. `remito.ts:106-107` — el '−' (U+2212) no existe en WinAnsi → **TODO pedido con descuento fiel falla el archivado para siempre** (retry y sweep inútiles). Fix: guion ASCII.
2. `remito.ts` — texto del cliente sin sanitizar: un **emoji en notas/nombre/dirección** → `archive_status='error'` irrecuperable (post-confirmación no se puede editar). Fix: sanitizar a CP1252 en `text()/right()/clip()`.
3. `api/order.ts:34` — producto no resuelto se graba a **$0 en silencio** (producto borrado/oculto, o fallo transitorio de Supabase → pedido ENTERO a $0). Fix: validar ids enteros + `active=is.true` + responder 409 si falta algo.
4. `confirm.ts` + `administradora.astro:284` — **doble click en Confirmar descuenta stock 2 veces** (el botón no se deshabilita y el status se chequea antes del patch). Fix: claim atómico (`PATCH ...&status=eq.pendiente` + representation) + `disabled` en el botón.
5. `api/order.ts` — el **pedido mínimo no se valida server-side** (desde /pedido se puede bajar el carrito por debajo de $40.000). Fix: chequear `TEIA_MIN_ORDER` tras re-precificar.

**Pack 2 — MEDIA — ✅ ARREGLADO 2026-07-17** (harness ampliado con caso de 30 ítems + notas largas;
paginación verificada con pdf-parse: 2 hojas, encabezado de continuación, notas completas):
6. `last-order.ts:32` — match de email por `includes` → devuelve el pedido de OTRO cliente (`ana@x.com` matchea `mariana@x.com`; `@gmail.com` enumera). Fix: igualdad exacta normalizada.
7. `archive.ts:33` — fallo transitorio leyendo ítems → **remito VACÍO marcado 'archivado'** definitivo. Fix: abortar si 0 ítems (todo pedido real tiene ≥1).
8. `api/order.ts:57-58` — insert de ítems y patch de order_number sin chequear → pedido sin ítems con "¡Pedido enviado!". Fix: chequear + borrar el header huérfano + 500.
9. Borrar pedido CONFIRMADO no repone stock, el botón aparece en cualquier estado y el diálogo no lo avisa (`admin/order.ts:21`, `administradora.astro:140`).
10. La respuesta de Confirmar (aviso `low_stock` + clamp silencioso a 0 si qty>stock) se descarta con `location.reload()` → **sobreventa sin aviso** (`administradora.astro:287`).
11. Remito: sin paginación (>~21 ítems se pisan con el pie), notas clipeadas a 1 línea (~90 de 500 chars), contacto sin clip, y `fmtDate` usa el día UTC de `confirmed_at` (confirmar 21:00-23:59 ART = día siguiente).
12. `auth.ts:12` — password con ñ/acentos NUNCA valida (atob latin1 vs Buffer utf8). Fix: `Buffer.from(provided,'latin1')`.
13. Recompra: `teia_last_order` guarda precios del día del pedido → meses después carga precios viejos (total visto ≠ grabado) y productos que ya no existen (alimenta el bug 3); "Cargar" duplica cantidades al doble click. `pedido.astro:64` — `JSON.parse` sin try/catch → checkout en blanco permanente si el localStorage se corrompe.

**Pack 3 — BAJA (pulido):** edición admin (qty vacío borra la línea sin aviso; sin cap 9999; escrituras sin chequear; select degradado pisa total con $0 — aplica también al toggle de descuento; `Math.round` pisa centavos; edita confirmados si se llama directo), `category.ts:27` todo fallo dice "Ya existe", pedido sin ítems sigue confirmable (remito vacío), `Base.astro:35` `querySelector('#3-leches')` tira SyntaxError (rubros que empiezan con número), HEIC no decodificable se sube igual (imagen rota), el `<input>` de notas del panel aplasta los saltos de línea del textarea, README desactualizado (n8n/Drive/N8N_WEBHOOK_URL; faltan sweep y env nuevas), sweep: 5 errores permanentes viejos bloquean el reintento del resto (`order=id.asc&limit=5`).

**Config (Federico):** ~~setear `CRON_SECRET`~~ — HECHA y verificada (sweep responde 401 sin auth).

**Pulido nuevo detectado en el e2e:** borrar un pedido NO borra sus PDFs del bucket `teia-remitos`
(quedan huérfanos en Storage — inofensivo y diminuto, pero decidir si el delete debe limpiarlos).

## 🔵 Fase 2 (nice-to-have)
- **Resumen semanal con IA** (código calcula números exactos desde la DB → Claude redacta el informe) — el gancho vendible.
- Lista de **clientes fieles** que pre-tilda el descuento −10% (match por teléfono; Mica siempre confirma).
- Estados **entregado / anulado** (anular reajusta stock).
- **Email** de aviso de poco stock + email de alerta cuando un archivado falla 3× (hoy solo estado en panel).
- Auto-edición del cliente hasta 24h antes del envío (hoy lo edita Mica).
- Endurecer `/api/client` si hiciera falta (hoy: cualquiera con el CUIT de un comercio ve sus datos de entrega, descuento y último pedido — baja sensibilidad, decisión consciente; heredado del criterio del viejo last-order).
