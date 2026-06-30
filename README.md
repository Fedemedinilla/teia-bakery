# Teia Bakery — canal mayorista (B2B)

App de pedidos mayoristas para Teia Bakery. Catálogo + carrito + panel de administración, con
descuento de stock y disparo del archivador n8n (remitos PDF → Drive → Google Sheet → email).
Es el **template e-commerce** de KyndredAI; Teia es el cliente #1.

## Stack
Astro 5 (static + adapter Vercel) · Supabase (Postgres, REST con service_role) · Vercel.

## Rutas
- **`/catalogo`** — tienda pública: productos, precios mayoristas, carrito.
- **`/pedido`** — carrito + checkout (datos del cliente, dirección y día de entrega) → crea la orden.
- **`/administradora`** — panel de Teia (Basic Auth): productos (alta/edición, stock, precio,
  aviso de poco stock), pedidos (confirmar → descuenta stock + dispara n8n), enlaces (Drive, Sheet, soporte).

## Datos / seguridad
- Source of truth = Supabase. El Google Sheet es un **espejo** (lo escribe n8n), no el hub.
- La `service_role` key bypassa RLS → es SECRETA, vive **solo** en Vercel env, nunca en el repo ni en el cliente.
- Los precios se **re-leen de la base** al crear el pedido (no se confía en el carrito del cliente).

## Setup
1. `npm install`
2. Crear el proyecto Supabase y correr `supabase/schema.sql` en el SQL Editor.
3. Variables de entorno (Vercel → Settings → Environment Variables, y `.env` local para `astro dev`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` *(Sensitive)*
   - `TEIA_ADMIN_PASSWORD` — la clave del panel
   - `N8N_WEBHOOK_URL` *(opcional)* — el webhook del archivador
4. `npm run dev` → http://localhost:4321/catalogo
5. Deploy: conectar el repo a un proyecto Vercel propio. Dominio: `app.teiabakery.com.ar`
   (demo en un subdominio de kyndredai por ahora).

## Pendiente (próximos pasos)
- Subida de imágenes a Supabase Storage (hoy `image_url` es un link pegado).
- Email de aviso de poco stock (hoy queda logueado en la función de confirmar).
- El workflow n8n del archivador + el resumen semanal.
