# Teia Bakery — canal mayorista (B2B)

App de pedidos mayoristas para Teia Bakery: **catálogo privado por cuenta**, panel de
administración, stock, **remito PDF automático** y **avisos de pedido nuevo** (notificación al
celular + mail). Se instala como app en el teléfono. Es el **template e-commerce** de KyndredAI;
Teia es el cliente #1.

## Stack
Astro 5 (`output:'static'` + adapter Vercel; las rutas con `prerender = false` corren como
serverless) · Supabase (Postgres + Storage, REST puro con `service_role`, sin SDK) · Vercel ·
pdf-lib · web-push.

> `astro.config.mjs` fija `vite.build.assetsInlineLimit: 0` **a propósito**: la CSP es estricta
> (`script-src 'self'`, sin `unsafe-inline`) y en producción Astro inlinearía los scripts chicos,
> que la CSP bloquearía dejando la página muerta. No se ve en `astro dev`.

## Rutas

**Gate privado: sin cuenta dada de alta no se ve nada, ni los precios.**

- **`/`** — la puerta. Se entra con el **CUIT** del comercio y su **contraseña** (la escribe la
  administradora a mano; se compara ignorando mayúsculas, espacios, símbolos y acentos). El 2º
  factor se enciende/apaga **desde el panel**, no con una env var: fila `require_code` de
  `teia_settings`. Firma una cookie de sesión HMAC, HttpOnly, de 90 días que se renueva en cada
  visita. Un CUIT no habilitado recibe un mensaje único —indistinguible del rechazo por
  contraseña incorrecta— y un botón de WhatsApp para pedir el alta.
- **`/catalogo`** — productos por rubro, carrito en vivo. La barra muestra el **umbral de envío
  sin cargo** de esa lista; **no bloquea nada**: si no llega, el pedido entra igual y Teia le cobra
  el envío. Cada cuenta ve **solo su lista** (`general` o `chungo`), con sus precios.
- **`/pedido`** — checkout. Los datos salen de la cuenta: el cliente no tipea su CUIT.
- **`/instalar`** — cómo instalar la app en iPhone (`?app=admin` para el panel).
- **`/administradora`** — panel (login por cookie firmada; `/administradora/ingresar`):
  **Pedidos** (detalle, edición, descuento por pedido, aviso de si el pedido llega o no al umbral
  de envío, **saldo anterior** y **costo de envío** que salen en el remito, confirmar → descuenta
  stock + genera el remito, borrar → repone stock, compartir el PDF), **Clientes** (alta por CUIT,
  contraseña, estado, historial, interruptor de CUIT+contraseña con guarda anti-lockout),
  **Productos** (alta/edición/stock, **recorte cuadrado de la foto**, copiar al otro catálogo con
  aviso de duplicados), **Rubros**, **Información** (lo que ven los clientes), **Envíos** (umbral
  sin cargo por lista).
  `?diag=1` muestra un diagnóstico técnico del globo del ícono (oculto para la clienta).

## Instalable en el celular (PWA)
**Dos apps sobre el mismo origen**, cada una con su manifest, ícono y nombre: **"Teia"** (la
tienda, `start_url /`) y **"Teia Panel"** (`start_url /administradora`). Los íconos se generan del
logo real con `scripts/pwa-icons.py`.

El service worker (`public/sw.js`) **nunca cachea HTML ni la API**: el catálogo muestra precios
distintos por lista y el panel está detrás de una clave, así que una copia guardada podría mostrar
datos de otra cuenta o sobrevivir a un "Salir". Solo se cachea `/_astro/` (lleva hash de contenido)
; las navegaciones pasan derecho al navegador (interceptarlas rompía la entrada en iPhone, ver el
comentario en `sw.js`). `/administradora` queda **fuera** del worker.

⚠️ En el handler de `push`, el aviso **nunca** puede esperar al globo del ícono: `setAppBadge`
puede no resolver nunca en iPhone y colgar el `waitUntil` hasta que el sistema mata al worker —el
banner se dibuja pero el aviso no queda guardado ni enciende la pantalla. Se espera el aviso
primero y el globo después, con tope de 1 s.

## Avisos de pedido nuevo
Al entrar un pedido se disparan **en paralelo** y siempre best-effort (nunca pueden voltear ni
demorar un pedido; si falta configuración, no se mandan y no rompen):

- **Notificación al celular** (`src/lib/push.ts`): requiere las dos claves VAPID, la tabla
  `teia_push_subs` y que la administradora toque **Activar** desde la app **instalada**.
  `GET /api/admin/push` es el diagnóstico: dice si las claves son del mismo par, si existe la
  tabla, cuántos dispositivos hay suscriptos y si el mail está configurado.
- **Mail** (`src/lib/aviso.ts`, Resend por REST).

## Datos / seguridad
- **Supabase es la fuente de verdad**; el Google Sheet es un **espejo de solo lectura** que se
  reconstruye entero en cada cambio. Los remitos viven en el bucket **privado** `teia-remitos` y se
  sirven con URLs firmadas de 120 s vía `/api/admin/remito`, gated por la clave del panel.
- La `service_role` key bypassa RLS → SECRETA, **solo** en las env de Vercel.
- La identidad del cliente sale **siempre de la cookie firmada**, nunca del body: `/api/order`
  relee la cuenta y filtra los productos por su catálogo (un id de la otra lista da 409).
- Los **precios se re-leen de la base** al crear el pedido. **Ningún pedido se rechaza por monto**,
  a propósito: el umbral es informativo y decide quién paga el envío, no si se puede comprar.
- Todo dato de la base que va dentro de un atributo HTML pasa por **`attrSafe()`** (ver el
  comentario en `src/lib/catalogs.ts`: `addAttribute` de Astro no escapa en un caso puntual).
- Las páginas con datos de una cuenta mandan `Cache-Control: private, no-store`. Y si la base no
  responde, se muestra un 503 amable **sin tocar la cookie**: un error pasajero no puede costarle
  la sesión a un comercio (`src/lib/nodisponible.ts`).
- Archivador robusto: remito WinAnsi-safe (emoji/★ no lo rompen), paginado, retry idempotente;
  barrido nocturno (`/api/cron/sweep`, cron de Vercel) que reintenta fallidos y hace de keep-alive
  del free tier.

## Setup
1. `npm install`
2. Crear el proyecto Supabase y correr **`supabase/schema.sql`** completo en el SQL Editor
   (incluye tablas, buckets y la sección de migración para bases existentes).
3. Env vars (Vercel → Settings → Environment Variables; `.env` local para `astro dev`).
   **La lista completa y comentada está en `.env.example`** — las mínimas para funcionar:
   - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` *(Sensitive — la service_role, NO la publishable)*
   - `TEIA_ADMIN_PASSWORD` — la clave del panel
   - `TEIA_SESSION_SECRET` — firma la cookie de sesión (su propia env, ver `.env.example`)
   - `CRON_SECRET` — **requerida**: el cron es fail-closed y sin ella no corre el barrido
4. `npm run dev` → http://localhost:4321 (sin Supabase corre en **modo demo** con datos de
   ejemplo; se entra con el CUIT demo `20-00000000-1`).
5. Deploy: push a `main` → Vercel.

## Scripts
- **`npm run check`** — verificador de tipos. ⚠️ `npm run build` **NO evalúa el frontmatter de las
  páginas**: un identificador que no existe (por ejemplo un helper que se dejó de importar) compila
  igual y revienta con 500 recién en producción, y **solo en la rama con Supabase conectado** — el
  modo demo no la ejecuta. Ya pasó una vez. Antes de deployar un cambio en el frontmatter de una
  página, correr esto y mirar los errores **`ts(2304) Cannot find name`**: esa clase es real. El
  resto del ruido es tipado laxo preexistente, todavía sin limpiar.
- `npm run vapid` — genera el par de claves VAPID para las notificaciones (una sola vez).
- `python scripts/pwa-icons.py` — regenera los íconos de las dos apps desde el logo.
- `npx tsx scripts/test-remito.ts` — remitos con inputs hostiles (emoji, NFD, 30 ítems con
  paginación) y casos limpios.
- `npx tsx scripts/test-cuit.ts` — validador de CUIT contra CUITs públicos conocidos.
- `node scripts/preview-aviso.ts` / `node scripts/preview-remito.mjs` — vistas previas.

## Documentación
- **`BUCKETLIST.md`** — la lista canónica de lo hecho y lo que falta. Se lee y se actualiza en
  cada sesión.
- `teia/RUNBOOK-ROTACION-SECRETOS.md` — cómo rotar cada clave, en qué orden y qué se rompe.
- `teia/RUNBOOK-INCIDENTES.md` — qué hacer en las primeras horas ante un incidente.
- `teia/HANDOFF-RUNBOOK.md` — el traspaso de las cuentas a la clienta.
