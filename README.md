# Teia Bakery — canal mayorista (B2B)

App de pedidos mayoristas para Teia Bakery: catálogo con carrito, **cuentas de clientes por CUIT**
(con descuento fiel por cliente), panel de administración, stock y **remitos PDF automáticos**.
Es el **template e-commerce** de KyndredAI; Teia es el cliente #1.

## Stack
Astro 5 (`output:'static'` + adapter Vercel; las rutas con `prerender = false` corren como
serverless) · Supabase (Postgres + Storage, REST puro con `service_role`) · Vercel · pdf-lib.

## Rutas
- **`/catalogo`** — tienda pública: productos por rubro, carrito en vivo con pedido mínimo,
  **"Ingresá con tu CUIT"** (autocompletado + recompra del último pedido, cross-device). El
  cliente con descuento fiel ve el catálogo con el precio de lista tachado y el precio neto.
- **`/pedido`** — checkout: **CUIT obligatorio** (verificador mod-11 validado), datos
  autocompletados desde la cuenta; la cuenta nueva se crea sola con el primer pedido.
- **`/administradora`** — panel de Teia (Basic Auth): **Pedidos** (detalle, edición, descuento
  por pedido, confirmar → descuenta stock + genera remitos, borrar → repone stock), **Clientes**
  (CUIT = comercio: datos, notas, descuento fiel del cliente, historial con links a remitos),
  **Productos** (alta/edición/foto/stock), **Rubros**.

## Datos / seguridad
- **Supabase es la fuente de verdad.** Los PDF viven en Storage (`teia-remitos`); el Google
  Sheet espejo está pendiente (ruta OAuth propuesta, ver BUCKETLIST).
- La `service_role` key bypassa RLS → SECRETA, vive **solo** en las env de Vercel.
- Los **precios se re-leen de la base** al crear el pedido; el **descuento fiel se resuelve
  server-side** por cuenta (el navegador jamás manda un porcentaje) y queda snapshoteado en la
  orden. El pedido mínimo se valida también en el server, sobre precio de lista.
- Archivador robusto: 2 PDF por pedido (cliente + hoja interna), WinAnsi-safe (emoji/★ no lo
  rompen), paginado, retry idempotente; barrido nocturno (`/api/cron/sweep`, cron de Vercel
  03:00 AR) que reintenta fallidos y hace de keep-alive del free tier.

## Setup
1. `npm install`
2. Crear el proyecto Supabase y correr `supabase/schema.sql` en el SQL Editor (incluye la
   sección de migración para bases existentes).
3. Env vars (Vercel → Settings → Environment Variables; `.env` local para `astro dev`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` *(Sensitive — la service_role, NO la publishable)*
   - `TEIA_ADMIN_PASSWORD` — la clave del panel
   - `CRON_SECRET` *(recomendada)* — protege `/api/cron/sweep`
   - `TEIA_MIN_ORDER` *(opcional)* — pedido mínimo en ARS (default 40000)
4. `npm run dev` → http://localhost:4321/catalogo (sin Supabase corre en **modo demo**:
   datos de ejemplo, cuenta demo `20-00000000-1` con descuento para ver el catálogo rebajado)
5. Deploy: push a `main` → Vercel. Dominio futuro: `app.teiabakery.com.ar`.

## Scripts de regresión
- `npx tsx scripts/test-remito.ts` — genera remitos con inputs hostiles (emoji, NFD, 30 ítems
  con paginación) y casos limpios.
- `npx tsx scripts/test-cuit.ts` — validador de CUIT contra CUITs públicos conocidos.

## Pendiente (ver `BUCKETLIST.md`, la lista canónica)
- Espejo **Google Sheet + Drive** por año/mes/cliente (ruta OAuth `drive.file` propuesta).
- Test end-to-end en prod del flujo completo con cuentas.
- Fase 2: resumen semanal con IA (se cotiza aparte), estados entregado/anulado, emails de aviso.
