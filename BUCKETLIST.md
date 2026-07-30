# Teia Bakery — Bucketlist

App de pedidos mayorista (B2B). Live: **teia-bakery.vercel.app** · Repo: `Fedemedinilla/teia-bakery`
Stack: Astro 5 + Supabase (proyecto DEMOS, tablas `teia_`) + Vercel. Es el **template e-commerce** de KyndredAI.

> Lista canónica de tareas — se lee/actualiza cada sesión. Última reconciliación: **2026-07-28**.
>
> **Traspaso del 28/07 (lo que se hizo desde la sesión de KyndredAI): `teia/TRASPASO-2026-07-28.md`**
> — incluye los 10 hallazgos de la auditoría de seguridad que nunca llegaron a esta lista.

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
   Planilla dinámicos según el estado real. **CONECTADO y verificado en prod por Federico
   (2026-07-17): remitos en Drive + planilla con altas y bajas reflejadas.** Refinado después:
   fecha DD-MM-AAAA en los nombres de Drive + diseño de la planilla (encabezados terracota,
   cebrado crema, formato $, Resumen seccionado, sin "Hoja 1").
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

## 🚀 SPRINT POST-MEET 01 — hasta la entrega · **deadline: viernes 31/07**
*Decidido en la Meet 01 (2026-07-22). Trato CERRADO: 50% ahora + 50% contra entrega.
Contexto completo: `teia/MEET-01-resumen.md` · transcript: `teia/MEET-01-transcript.md`.
Resumen entregado a Mica: `teia/resumen-meet-mica.html` → PDF en Downloads.*

### 🔐 SEGURIDAD — hallazgos de la auditoría 27/07 CERRADOS 2026-07-28
*Fuente: `teia/TRASPASO-2026-07-28.md` §4 + `seguridad/hallazgos/teia-bakery/2026-07-27/`.
Cada uno cerrado sube el número del certificado de seguridad del kit de entrega.*

**Cerrados por código (deployado + revisión adversarial de 5 lentes limpia, todo "verificado sano"):**
- **DAT-02** — el bucket `teia-remitos` pasa a PRIVADO. Los remitos se sirven por un proxy nuevo
  `/api/admin/remito?id=X` (gated por la clave del panel) que genera una URL FIRMADA de 120 s.
  `archive.ts` guarda el PATH (no la URL pública); `sbSignedUrl` en `supabase.ts`; panel, botón
  Compartir y HYPERLINK del Sheet apuntan al proxy. El botón Compartir descarga el PDF en el
  fallback (no comparte un link admin-only). **El código anda con el bucket público o privado**
  (las URLs firmadas sirven en ambos); el cierre EFECTIVO exige el SQL de abajo.
- **IDN-01** — el secreto de firma de sesión usa su env propia `TEIA_SESSION_SECRET` (fallback a
  la de la base para no cortar sesiones). Ya no se reusa la service key.
- **IDN-12/PUB-07** — `entrar.ts` unificó los tres rechazos en un solo mensaje/403: no se puede
  distinguir un CUIT dado de alta de uno que no (verificado con 2FA on: los tres idénticos).
- **FRT-10** — la puerta ya no guarda el CUIT en localStorage (lo maneja el llavero del navegador
  vía `autocomplete="username"`).

**DAT-02 CERRADO Y VERIFICADO EN PROD (2026-07-28):** Federico corrió el `update ... set
public=false`; la URL pública de remitos ahora da `Bucket not found / NoSuchBucket` (privado),
el de fotos sigue público (`NoSuchKey`) y el proxy 401 sin clave. Bucket cerrado.

**⚠️ IDN-01 — falta el REDEPLOY:** Federico agregó la env `TEIA_SESSION_SECRET` en Vercel, pero
una env nueva no toma efecto hasta un redeploy. Hasta entonces la firma sigue cayendo a la
service key (por el fallback — nada se rompe). Un Redeploy en Vercel la activa. Al activarse, las
sesiones vivas piden re-login una vez (hoy cero impacto: no hay clientes reales).

**DAT-08 y DAT-12 CERRADOS 2026-07-30** (runbooks de una hoja): rotación de secretos
(`teia/RUNBOOK-ROTACION-SECRETOS.md` — lista de llaves = grep, orden seguro, efecto de cada una
y la regla de oro del acoplamiento IDN-01) y respuesta a incidentes (`teia/RUNBOOK-INCIDENTES.md`
— clave filtrada / abuso de endpoint / dependencia comprometida, cada paso con pantalla+comando+
aviso+plazo, con ensayo tabletop registrado). Suben dos el certificado.

**Quedan de la lista de 10 (no cerrados hoy):**
DEP-12 (repo privado, decisión de Federico), INF-12 (DMARC en teiabakery.com.ar, DNS de Federico),
IDN-11 (invalidación server-side de sesión — sobre-ingeniería para el porte; parcial vía `active`
+ rotar el secreto), IDN-09 (riesgo aceptado: CUIT es dato público — el 2º factor opcional lo cubre).

### 🔐 SEGURIDAD — auditoría 2026-07-22 (informe: `teia/AUDITORIA-SEGURIDAD.md`)
Corregido y deployado: **XSS almacenado** cliente→admin (bug de escapeo de atributos de Astro,
verificado ejecutando su runtime; fix `attrSafe()`), XSS reflejado en el callback de Google,
**CSRF del OAuth** (state), cron **fail-open**, orden auth-antes-que-config en los 9 endpoints
admin, secreto de firma hardcodeado, `/api/order` pisaba el contacto de la cuenta, vista previa
`?ver=` abierta en demo, **CSP estricta + HSTS**, y el botón Salir.

**⏸️ 2º factor CUIT+código: CONSTRUIDO Y APAGADO** (`TEIA_REQUIRE_CODE`). El CUIT es dato público
(AFIP/facturas) ⇒ por sí solo no protege precios. Encenderlo = 1 env var en Vercel + redeploy.
Panel: código por ficha con "Generar" y "Enviar por WhatsApp" (mensaje ya escrito). Se pide **una
vez por dispositivo**: sesión de 90 días **que se renueva en cada visita** + `autocomplete` para
que el llavero del celular lo guarde. **Pendiente: que Federico lo hable con Mica.**

**Config pendiente de Federico:** regla de rate-limit del Firewall de Vercel sobre `/api/entrar`,
`/administradora` y `/api/admin/*` · marcar los secrets como "Sensitive" · SQL de `access_code`
(se puede correr ya, no afecta nada mientras el flag esté apagado) · probar el aislamiento de
catálogos en prod con dos cuentas reales · post-entrega: migrar a Astro 7.

### ❓ ABIERTAS — decide Federico ANTES de que arranque el bloque correspondiente
| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| A | Canal del aviso de pedido nuevo | ✅ **RESUELTA: email con Resend.** Fundamentación completa + texto para Mica en `teia/aviso-pedidos-resend-vs-whatsapp.md` |
| B | Productos de Chungo | ✅ **RESUELTA: catálogo VIP separado**, único para TODOS los CUIT de Chungo (es una franquicia: varios locales, cada uno con su CUIT) |
| C | Rollback del auto-alta | ✅ **RESUELTA: se hace.** De tienda abierta a carta VIP: solo entra quien Teia puso antes en la whitelist (del catálogo normal o del de Chungo) |
| D | Resumen por cliente en Drive | ✅ **RESUELTA: `Remitos Teia/Clientes/<Comercio>/`** con su planilla; los remitos siguen en año/mes. Formato final espera sus screenshots |

---

### ✅ BLOQUE 1 — HECHO 2026-07-22 (verificado en preview + build verde)
*Incluyó un extra no planeado: el "bug" de CUITs que Federico sufrió en la meet.*

**1.0 · CUIT: avisar en vez de bloquear** — diagnóstico: el validador estaba BIEN; para un
prefijo dado hay UN solo dígito verificador válido, así que inventar CUITs falla 10 de 11 veces
(`scripts/cuit-demo.ts` lo demuestra). El error de diseño era **bloquear**. Ahora: se exige solo
la FORMA (11 dígitos, `hasCuitShape`); el verificador se usa para AVISAR al guardar en el panel
("ojo, no pasa el verificador de AFIP") pero **guarda igual** — Teia sabe quiénes son sus
clientes mejor que un algoritmo. El filtro real pasa a ser la whitelist de cuentas.

**1.1 · Descuento POR PEDIDO** (sale de la ficha del cliente)
- `api/order.ts`: deja de leer `teia_clients.discount_pct` → todo pedido nace en 0.
- `administradora.astro`: fuera el checkbox de descuento de la ficha del cliente (queda el toggle del pedido, que ya funciona y es lo que ella usa).
- `catalogo.astro` + `pedido.astro`: fuera el precio tachado, la línea "descuento aplicado" y el `net()` de la vista.
- La columna `teia_clients.discount_pct` NO se borra (pedidos viejos la snapshotearon); queda sin uso.

**1.2 · UN solo remito** (muere la hoja interna de preparación)
- `archive.ts`: genera y sube un solo PDF (Storage + Drive). `remito_interno_url` deja de escribirse.
- `remito.ts`: la variante `'interno'` deja de invocarse (el código queda; cuesta cero y por si vuelve).
- Panel (tarjeta + modal de detalle), Sheet y Drive: un solo link "📄 Remito".

**1.3 · Fuera "Repetir último pedido"** (confunde: casi nunca repiten)
- `catalogo.astro`: se elimina la tarjeta de recompra + `loadIntoCart` + `renderReorderCard`.
- `api/client.ts`: deja de devolver `last_order` (queda identidad + datos).
- ⚠️ El autocompletado de datos por CUIT NO se toca: eso SÍ lo quiere.

**1.4 · Botón COMPARTIR el remito** (del panel al WhatsApp, sin descargar)
- Botón "Compartir" en la tarjeta del pedido confirmado.
- `fetch` del PDF → `navigator.share({files})` (Web Share nivel 2, anda en Android/iOS).
- Cascada de fallbacks: sin soporte de archivos → `navigator.share({url})` → sin share → copia el link al portapapeles + aviso. En desktop siempre cae al portapapeles.

---

### ✅ BLOQUE 2 — GATE PRIVADO · HECHO 2026-07-22 (+ la mayor parte del 3)
*Patrón calcado del Bayard (allowlist con columna de rol): acá `teia_clients.catalog` con
`check (catalog in ('general','chungo'))`, y **Mica elige la lista al dar de alta**.*

Las 3 listas quedan así: **sin cuenta → no entra** · **`general` → catálogo mayorista** ·
**`chungo` → catálogo VIP** (una franquicia: todos sus locales, cada uno con su CUIT).

- **`lib/session.ts`** — cookie `teia_sess` HttpOnly + SameSite=Lax + firma HMAC con la
  service key (comparación timing-safe), 90 días. El servidor resuelve quién es el cliente
  desde la cookie: el navegador no puede decir "soy otro" ni cambiarse de catálogo.
- **`lib/catalogs.ts`** — las listas en un solo lugar (slug + label + validación).
- **Puerta `/` (`index.astro` + `/api/entrar`)** — pide CUIT, valida contra la whitelist
  (y `active`), firma la cookie y manda al catálogo. CUIT no habilitado → mensaje amable +
  **botón de WhatsApp** (el rechazo se convierte en consulta). `/api/salir` para cambiar de cuenta.
- **`/catalogo` y `/pedido` detrás del gate** — sin sesión → redirect a la puerta; los
  productos se filtran por `catalog` del cliente y los datos del checkout salen de su cuenta
  (el campo CUIT desapareció del checkout).
- **`/api/order` confía SOLO en la sesión** — no en el body: relee la cuenta, valida `active`,
  y el select de productos lleva `catalog=eq.<el del cliente>` → un id del otro catálogo, aunque
  lo manden a mano, devuelve 409.
- **Panel** — alta con **selector de lista** + contacto; en cada ficha: catálogo y estado
  (Habilitado / De baja, sin borrar historial); badges VIP y "de baja"; productos con su
  columna Catálogo y selector en el form; **vista previa de cada catálogo** (`/catalogo?ver=…`,
  solo admin) porque con el gate el link de antes ya no servía.
- **Limpieza:** `/api/client.ts` borrado (redundante con la sesión) y toda la identificación
  JS del catálogo/checkout.
- Verificado en demo: sin cuenta → redirect + 403 · general ve solo lo general · Chungo ve solo
  lo suyo con SUS precios · salir vuelve a dejar afuera.

**⚠️ SQL para prod** (`supabase/schema.sql`, sección migración):
`teia_clients.catalog`, `teia_clients.active`, `teia_products.catalog`.

**Bloque 3 COMPLETO 2026-07-30:** botón "Copiar a &lt;otro catálogo&gt;" en la pestaña Productos
— clona el producto al otro catálogo como NUEVO (id vacío), abre el form de alta precargado con el
precio enfocado; Mica solo ajusta el precio y guarda. Se adapta al origen (general→Chungo y
viceversa). Verificado en demo.

---

### 📱 PWA — LA APP SE INSTALA EN EL CELULAR (2026-07-30, live y verificado en prod)
Dos apps instalables desde el mismo sitio, sin App Store ni cuenta de desarrollador:
**"Teia"** (tienda, start_url `/`, ícono crema) y **"Teia Panel"** (start_url `/administradora`,
ícono oscuro). Íconos = la "T" del logo real (`scripts/pwa-icons.py`). El deploy no cambia:
`git push` y los teléfonos ya instalados se actualizan solos (verificado en prod: un navegador con
la versión vieja pasó a v2 y purgó el caché anterior sin intervención).

**Asistente de instalación** (`src/components/InstalarApp.astro`, en /catalogo y /administradora):
en iPhone **no existe** el aviso de instalación de Apple, así que se explica el camino manual
(Compartir → "Agregar a inicio") y se avisa del error común (abrir el link desde otra app, donde
esa opción no aparece); en Android se captura `beforeinstallprompt` y se muestra un botón propio.

**Seguridad del caché** (revisión adversarial de 4 lentes; 3 hallazgos corregidos):
- El **panel queda FUERA del service worker**: un 401 devuelto por un `fetch()` hecho desde el SW
  no dispara el cartel de usuario/clave → Mica podía quedarse sin poder entrar. ← era el grave.
- Se cachea **solo `/_astro/`** (lleva hash de contenido). Íconos/logo/img no se cachean: sin hash,
  quedarían pegados salvo subir VERSION a mano, lo que contradecía "se actualiza sola".
- **`Cache-Control: private, no-store` en `/administradora` y `/`** (faltaban; /catalogo y /pedido
  ya lo tenían). El panel devuelve la base entera.
- Auditoría en prod: el caché tiene **solo `offline.html`** — cero HTML de panel/catálogo y cero API.
- **La CSP no se tocó**: `worker-src` cae en `script-src` y `manifest-src` en `default-src`, ambos `'self'`.

**Entregables:** `teia/instalacion/instalar-app-cliente.pdf` y `instalar-panel-teia.pdf` (QR + pasos
Android/iPhone) + la página **`/instalar`** dentro de la app (timeline de 4 pasos con la barra de
Safari dibujada en SVG). ⚠️ Las instrucciones viven en DOS lugares: si se cambian, sincronizar.
**⚠️ Handoff:** el `id` del manifest es relativo al origen → instalar en el teléfono de Mica
**desde el dominio definitivo**, no desde el de Vercel, o hay que reinstalar.

### 🔔 AVISOS AL CELULAR (push) — CONSTRUIDO 2026-07-30, **APAGADO** hasta el traspaso
Al entrar un pedido, notificación al celular de Mica: *"Nuevo pedido — TEIA-0042 / Comercio ·
$48.000"*; al tocarla abre el panel en Pedidos (si ya está abierto, le da foco). Un aviso por
pedido (tag = nº de pedido): dos pedidos distintos no se pisan.

**Queda INERTE**: sin las claves VAPID y sin el permiso de Mica no manda nada. Piezas:
`scripts/vapid-keys.mjs` (genera el par, una vez) · `src/lib/push.ts` (envío best-effort, nunca
lanza, timeout 6s, borra sola la suscripción ante 404/410) · handlers `push` y `notificationclick`
en `public/sw.js` · `api/admin/push.ts` (alta/baja, gate de admin primero) ·
`ActivarAvisos.astro` (el botón; en iPhone sin app instalada NO lo ofrece, manda a instalarla) ·
tabla `teia_push_subs` en schema.sql · 2 env vars.

Usa la librería **web-push** (no se escribió la criptografía a mano: un error ahí es invisible
hasta que el aviso no llega, y la entrega no se puede probar sin un teléfono). No agrega alertas
de `npm audit`.

**Verificado:** sin claves → 0 ms sin excepción; con claves pero SIN la tabla → 46 ms, tampoco
lanza ⇒ **un pedido no se puede romper ni demorar por esto** (es la trampa del `access_code`,
cubierta por diseño). En prod tras el deploy: `/api/order` responde 401 normal (no 500), o sea que
web-push se empaquetó bien. **NO verificable sin teléfono: que la notificación efectivamente
llegue** — se prueba en la llamada.

**Para activar (3 pasos, en el traspaso):** `node scripts/vapid-keys.mjs` → pegar
`TEIA_VAPID_PUBLIC_KEY` y `TEIA_VAPID_PRIVATE_KEY` (Sensitive) en Vercel + Redeploy · correr el SQL
de `teia_push_subs` · con Mica: app instalada → botón **Activar** → pedido de prueba.

### ⚠️ SEGURIDAD — CVEs de Astro 5 (detectado 2026-07-30, NO explotable hoy)
`npm audit` marca varios avisos **altos** en Astro ≤7.0.9 y `@astrojs/vercel` (XSS varios, y
**override de ruta vía header `x-astro-path`**). Probado contra prod: el override **funciona**,
pero `/administradora` y `/api/admin/{client,confirm,order,product,remito}` devuelven **401** y el
cuerpo servido es la puerta de login, sin rastro del panel. Aguanta porque la auth está DENTRO de
cada endpoint y no en un middleware (fix del audit 22/07). **Se cierra migrando a Astro 7**, que ya
estaba en la lista post-entrega — esto le sube la prioridad. No tocar antes de entregar: es breaking.

---

### 🟠 BLOQUE 4 — Resumen por cliente en Drive · depende de las screenshots de Mica
*Ella quiere entrar a la carpeta de un cliente y ver SU resumen, no todo junto en un cuadro.*
- `Remitos Teia/Clientes/<Comercio>/` con una planilla **"Resumen — <Comercio>"**: pedidos (con link a cada remito), totales por semana, por mes, y ranking de sus productos.
- Los remitos siguen en `Remitos Teia/2026/07 - Julio/<Comercio>/` (estructura que ella ya aprobó).
- Se reusa entera la maquinaria de `lib/google.ts` (auto-provisión + rebuild idempotente + el diseño de planilla ya hecho).
- **El formato final se calca de SU sistema actual** — por eso espera las capturas (pedido explícito en la meet: "mejorar el que ya tenés, no crear uno nuevo").

---

### ✅ BLOQUE 5 — HECHO 2026-07-28 (lo que dependía de material de Mica)

**5.1 · Aviso de pedido nuevo por MAIL** — `src/lib/aviso.ts` (Resend por REST, sin SDK, como el
resto de las integraciones). Se dispara en `api/order.ts` **después** de que el pedido quedó
guardado: nº, comercio + CUIT, contacto, dirección, aclaraciones, ítems, total y botón al panel.
Best-effort con timeout propio de 6 s y try/catch — no puede voltear ni demorar un pedido. Sin
`RESEND_API_KEY` / `TEIA_ALERT_EMAIL` no manda y no rompe (igual que Google y el archivador).
Paleta de Teia, tablas + estilos en línea (los clientes de correo no soportan flex/grid).
Vista previa: `node scripts/preview-aviso.ts` → `.test-out/aviso.html`. Verificado visualmente.
**Env vars nuevas para Federico:** `RESEND_API_KEY`, `TEIA_ALERT_EMAIL` y, si el remitente no es
el default, `TEIA_ALERT_FROM` (default `Teia Bakery <pedidos@kyndredai.com>` — **hay que verificar
ese dominio/remitente en Resend antes de que ande en prod**).
Fundamentación de por qué mail y no WhatsApp: `teia/aviso-pedidos-resend-vs-whatsapp.md`.

**5.2 · Logo de Teia en la app y el remito** — Mica pasó el original de Illustrator.
`scripts/logo.mjs` lo convierte: PNG transparente recortado (`public/logo-teia.png`, 2432×273) +
versión chica embebida en base64 (`src/lib/logo-teia.ts`, 620×70) porque `public/` no existe en el
disco de una función serverless. Aplicado en las **cuatro** superficies: la **puerta**
(`.gate__logo`, 21 px), el **header del catálogo** (`.brand__logo`, 17 px — el mismo cuerpo que
tenía el wordmark; con menos altura perdía peso), el **panel** (`.brand--fila`, 17 px, en una
línea con un separador y la etiqueta "Administradora", porque el h1 "Panel" viene justo abajo y
dos bloques apilados competían) y el **remito** (primera hoja y continuación, con caída al
wordmark tipográfico si el embed fallara). Verificado en desktop y en móvil: sin solapes ni
scroll horizontal.
**Color de marca: #2D2119** (muestreado del original) — el `--ink` de la app ya era #33291F, así
que la paleta no se toca. Verificado en el navegador y con un remito de prueba.

**Falta de este bloque:**
- **Tipografía de Teia** — Federico dice que Mica la pasó, pero el archivo no está en Downloads
  ni en el repo. Sin el .otf/.ttf (o el nombre de la fuente) no se puede aplicar. Hoy el display
  sigue siendo **Fraunces**, que combina bien con el wordmark.
- **Carga del catálogo real** (productos, packs, precios, fotos) — lo hace ELLA cuando esté online.
- **CUITs de los locales de Chungo** (para el alta + el catálogo VIP).

### ⚪ BLOQUE 5 bis — Bloqueados por material de Mica / decisión
- **Carga del catálogo real** (productos, packs, precios, fotos) — lo hace ELLA cuando esté online; Federico puede precargar los rubros.
- **CUITs de los locales de Chungo** (para el alta + el catálogo VIP).

---

### 🏁 BLOQUE 6 — Handoff (viernes o lunes, en llamada de 15-20 min)
1. Cuentas nuevas con el mail de Mica: **Vercel** (hosting) · **Supabase** (base) · **GitHub** (código) · **Google** (Drive + planilla). Los códigos de verificación llegan a su mail — por eso es en vivo.
2. Correr `supabase/schema.sql` completo en SU proyecto + migrar los datos que haga falta.
3. Re-consentir Google desde SU cuenta → pegar el `GOOGLE_OAUTH_REFRESH_TOKEN` nuevo → **la carpeta y la planilla se auto-crean en su Drive** (arquitectura transportable, ya probada).
4. Env vars en su Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEIA_ADMIN_PASSWORD` (**la elige ella**), `CRON_SECRET`, `TEIA_MIN_ORDER`, las 3 de Google.
5. **Dominio**: entrar al registrador de `teiabakery.com.ar` (¿Tiendanube?) → subdominio `app.teiabakery.com.ar`.
6. Guía de uso corta con capturas + repaso en la próxima reunión (fin de la semana que viene).

---

### 🧹 Deuda técnica que arrastramos (no bloquea la entrega)
- **Pack 3 de la auditoría** (pulido: qty vacío borra línea sin aviso, `category.ts` reporta mal los fallos, `Base.astro` rompe con rubros que empiezan con número, HEIC no decodificable, notas del panel aplastan saltos de línea).
- PDFs **huérfanos en Storage** al borrar un pedido (inofensivo, decidir si el delete limpia).
- `TEIA-0009` quedó **pendiente en el panel** — confirmarlo o borrarlo (era la prueba de links + resumen semanal).
- Los remitos de prueba viejos en Drive tienen el nombre sin fecha (los nuevos ya la llevan).

## 📩 Pedidos de Mica (WhatsApp 2026-07-06) — estado (superseded por MEET 01 donde contradiga)
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
