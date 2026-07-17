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

## 📩 Pedidos de Mica (WhatsApp 2026-07-06) — scope a decidir con Federico
1. **Dos listas de precios** (una para Chungo, otra mayorista general) — propuesta: tabla
   `teia_clients` (nombre, contacto, dirección, lista de precios, token) + segundo precio por
   producto + **link propio por cliente** (`/catalogo?c=<token>`) que muestra su lista.
2. **Datos del cliente pre-cargados** — el mismo link propio pre-llena nombre/dirección en el
   checkout (resuelve 1 y 2 con la misma pieza). Complementa el last-order por WhatsApp que ya existe.
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

**Config (Federico):** setear `CRON_SECRET` en Vercel — sin ella el sweep queda abierto (por diseño, pero recomendada).

## 🔵 Fase 2 (nice-to-have)
- **Resumen semanal con IA** (código calcula números exactos desde la DB → Claude redacta el informe) — el gancho vendible.
- Lista de **clientes fieles** que pre-tilda el descuento −10% (match por teléfono; Mica siempre confirma).
- Estados **entregado / anulado** (anular reajusta stock).
- **Email** de aviso de poco stock + email de alerta cuando un archivado falla 3× (hoy solo estado en panel).
- Auto-edición del cliente hasta 24h antes del envío (hoy lo edita Mica).
- Endurecer `/api/last-order` si hiciera falta (hoy: cualquiera con un teléfono ve el último pedido de ese teléfono — baja sensibilidad, decisión consciente).
