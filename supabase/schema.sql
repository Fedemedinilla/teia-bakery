-- Teia Bakery — esquema del canal MAYORISTA.
-- Tablas prefijadas `teia_` para convivir con OTRAS demos en el mismo proyecto Supabase DEMOS
-- (convención: cada demo namespacea sus tablas con el nombre de la app). El mismo esquema se
-- copia idéntico cuando la app pasa al proyecto dedicado del cliente. Correr en el SQL Editor.

create table if not exists teia_products (
  id                  bigint generated always as identity primary key,
  name                text not null,
  description         text default '',
  category            text default '',            -- rubro para las secciones (Tortas, Salados…)
  image_url           text default '',
  pack_label          text default '',            -- ej. "x6", "x12", "por kg"
  pack_size           int  default 1,
  price               numeric(12,2) not null default 0,  -- precio MAYORISTA por pack
  stock               int  not null default 0,    -- en packs
  low_stock_threshold int  not null default 5,
  active              boolean not null default true,
  catalog             text not null default 'general' check (catalog in ('general','chungo')),
  sort_order          int  default 0,
  created_at          timestamptz not null default now()
);

-- Cuentas de clientes mayoristas: el CUIT es la identidad y la LLAVE de entrada.
-- Nadie ve el catálogo sin estar acá: el alta la hace Teia desde /administradora, y al darla
-- elige a qué LISTA (catálogo) pertenece. Mismo patrón que la allowlist por rol del Bayard.
--   · sin cuenta        → no entra
--   · catalog='general' → catálogo mayorista normal
--   · catalog='chungo'  → catálogo VIP de Chungo (todos sus locales, cada uno con su CUIT)
-- (Va ANTES de teia_orders: la FK client_id la referencia.)
create table if not exists teia_clients (
  id               bigint generated always as identity primary key,
  cuit             text not null unique,     -- normalizado: solo dígitos (11)
  business_name    text not null,            -- nombre del comercio/empresa
  client_contact   text default '',          -- WhatsApp o email
  delivery_address text default '',
  catalog          text not null default 'general' check (catalog in ('general','chungo')),
  active           boolean not null default true,  -- baja sin borrar historial
  access_code      text,                           -- 2º factor OPCIONAL (ver TEIA_REQUIRE_CODE)
  discount_pct     int  not null default 0,  -- legacy: el descuento pasó a ser por pedido
  notes            text default '',          -- notas internas de Mica
  created_at       timestamptz not null default now(),
  last_order_at    timestamptz
);

create table if not exists teia_orders (
  id               bigint generated always as identity primary key,
  order_number     text unique,               -- ej. "TEIA-0042"
  client_id        bigint references teia_clients(id) on delete set null, -- la cuenta (el pedido sobrevive si se borra)
  client_name      text not null,
  client_contact   text not null,             -- WhatsApp o email
  delivery_address text not null,
  delivery_date    date,
  notes            text default '',
  status           text not null default 'pendiente',  -- pendiente|confirmado|entregado|anulado
  version          int  not null default 1,
  total            numeric(12,2) not null default 0,
  discount_pct     int  not null default 0,   -- descuento fiel (toggle manual en el panel)
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  -- Archivador de remitos (app-native): 2 PDFs → Supabase Storage `teia-remitos`
  archive_status     text,                    -- null (no corrió) | 'archivado' | 'error'
  archive_error      text,
  archived_at        timestamptz,
  remito_cliente_url text,
  remito_interno_url text
);

-- MIGRACIÓN para bases que ya existían antes de estas columnas (correr en el SQL Editor;
-- en una base nueva son no-ops porque el create de arriba ya las trae):
alter table teia_orders add column if not exists client_id bigint references teia_clients(id) on delete set null;
alter table teia_orders add column if not exists discount_pct       int not null default 0;
-- Listas de acceso (gate privado) + catálogo por producto:
alter table teia_clients  add column if not exists catalog text not null default 'general';
alter table teia_clients  add column if not exists active  boolean not null default true;
alter table teia_products add column if not exists catalog text not null default 'general';
-- Código de acceso (2º factor). Se puede correr AHORA: mientras `TEIA_REQUIRE_CODE` no esté
-- en 'true', la columna queda ahí sin usarse y la entrada sigue siendo solo con CUIT.
alter table teia_clients  add column if not exists access_code text;
alter table teia_orders add column if not exists archive_status     text;
alter table teia_orders add column if not exists archive_error      text;
alter table teia_orders add column if not exists archived_at        timestamptz;
alter table teia_orders add column if not exists remito_cliente_url text;
alter table teia_orders add column if not exists remito_interno_url text;
-- Montos que la administradora carga al confirmar, y que el remito imprime debajo del total.
-- NULL a propósito = "no cargado": el PDF dibuja un renglón en blanco para completarlo a mano
-- (así funciona su planilla de Excel). NO entran en `total`, que sigue siendo la venta de
-- mercadería: es lo que suma el Sheet espejo y lo que /api/admin/order recalcula desde los ítems
-- en cada guardado — cualquier cosa que le sumáramos ahí se borraría al siguiente Guardar.
-- saldo_anterior admite negativos (saldo a favor del comercio).
alter table teia_orders add column if not exists saldo_anterior numeric(12,2);
alter table teia_orders add column if not exists costo_envio    numeric(12,2);
-- Foto ORIGINAL del producto. `image_url` pasa a ser el RECORTE cuadrado que ve el cliente; la
-- original se guarda acá para poder reencuadrar cuantas veces haga falta sin perder calidad.
alter table teia_products add column if not exists image_original_url text;

create table if not exists teia_order_items (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references teia_orders(id) on delete cascade,
  product_id  bigint references teia_products(id),
  name        text not null,
  pack_label  text default '',
  qty         int  not null,                  -- cantidad de packs
  unit_price  numeric(12,2) not null,
  line_total  numeric(12,2) not null
);

create index if not exists idx_teia_orders_status     on teia_orders(status);
create index if not exists idx_teia_order_items_order on teia_order_items(order_id);
create index if not exists idx_teia_orders_client     on teia_orders(client_id);

-- RLS: la app pega desde el server con la service_role key (la bypassa). Igual ACTIVAR RLS
-- para que la anon key no pueda leer/escribir nada directo (sin policies = todo denegado a anon).
-- Rubros / categorías del catálogo (gestionables desde /administradora).
create table if not exists teia_categories (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  sort_order  int default 0,
  created_at  timestamptz not null default now()
);

-- Información para el cliente: medios de pago, envíos, cuánto duran los productos.
-- La edita la ADMINISTRADORA desde la pestaña "Información" del panel — si mañana cambia el
-- mínimo para envío sin cargo, lo cambia ella sin depender de nadie. Se muestra al final del
-- catálogo (plegada) y resumida arriba del botón de enviar el pedido.
create table if not exists teia_info (
  id          bigint generated always as identity primary key,
  pregunta    text not null,
  respuesta   text not null,
  sort_order  int default 0,
  -- true = además de salir en el catálogo, se repite en la pantalla de confirmar el pedido.
  -- La administradora lo destilda desde el panel para lo que ahí ya no aporta.
  en_checkout boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table teia_info add column if not exists en_checkout boolean not null default true;

-- Teléfonos suscriptos a los avisos de pedidos nuevos (notificaciones push del panel).
-- Una fila por dispositivo que activó los avisos desde /administradora. El `endpoint` es la
-- dirección que da el navegador (Apple o Google según el teléfono) y es único por dispositivo;
-- las claves son las que permiten cifrarle el mensaje. Se borran solas cuando el servicio
-- responde que la suscripción ya no existe (borró la app o revocó el permiso).
create table if not exists teia_push_subs (
  id          bigserial primary key,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- Ajustes de la app que edita la ADMINISTRADORA, sin redeploy y sin depender de nadie.
-- Clave/valor de texto, una fila por ajuste. Se eligió clave/valor y no una tabla por catálogo
-- porque las listas viven en el CÓDIGO (CATALOGS en src/lib/catalogs.ts): no hay ninguna fila de
-- catálogo a la que agregarle una columna. Y el próximo ajuste que quiera tocar no necesita SQL.
--
-- ⚠️ La app SIEMPRE lee esta tabla con la variante NO estricta: si todavía no existe, cada lector
-- cae a su valor por defecto y no se cae nada. Acá no se decide plata, solo qué frase se muestra.
--
-- Claves en uso:
--   envio_min_<lista>  umbral de ENVÍO SIN CARGO de esa lista, en pesos (la arma la app desde la
--                      lista cerrada de catálogos, así que no entra nada arbitrario)
--   require_code       'true' = los comercios entran con CUIT + contraseña; cualquier otra cosa,
--                      solo con CUIT. Se enciende desde el panel, NO con una env var.
create table if not exists teia_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- Valores iniciales. `do nothing` = volver a correr este archivo NO pisa lo que ella haya
-- cambiado después desde el panel. Y correr el SQL no enciende nada: require_code arranca en false.
insert into teia_settings (key, value) values
  ('envio_min_general', '140000'),
  ('envio_min_chungo',  '250000'),
  ('require_code',      'false')
on conflict (key) do nothing;

alter table teia_products    enable row level security;
alter table teia_orders      enable row level security;
alter table teia_order_items enable row level security;
alter table teia_categories  enable row level security;
alter table teia_clients     enable row level security;
alter table teia_push_subs   enable row level security;
alter table teia_info        enable row level security;
alter table teia_settings    enable row level security;

-- Storage: bucket PÚBLICO para las fotos de producto (subida desde /administradora con la
-- service_role key; lectura pública vía URL). Correr una vez.
insert into storage.buckets (id, name, public)
values ('teia-productos', 'teia-productos', true)
on conflict (id) do nothing;

-- Storage: bucket PRIVADO para los remitos PDF (tienen datos del comercio: razón social,
-- dirección, contacto, ítems y precios). Se suben con la service_role key y se sirven con
-- URLs FIRMADAS temporales vía /api/admin/remito (gated por la clave del panel). NUNCA públicos.
insert into storage.buckets (id, name, public)
values ('teia-remitos', 'teia-remitos', false)
on conflict (id) do nothing;
-- Si el bucket ya existía como público, esto lo pasa a privado (idempotente):
update storage.buckets set public = false where id = 'teia-remitos';
