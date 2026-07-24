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
alter table teia_orders add column if not exists archive_status     text;
alter table teia_orders add column if not exists archive_error      text;
alter table teia_orders add column if not exists archived_at        timestamptz;
alter table teia_orders add column if not exists remito_cliente_url text;
alter table teia_orders add column if not exists remito_interno_url text;

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

alter table teia_products    enable row level security;
alter table teia_orders      enable row level security;
alter table teia_order_items enable row level security;
alter table teia_categories  enable row level security;
alter table teia_clients     enable row level security;

-- Storage: bucket PÚBLICO para las fotos de producto (subida desde /administradora con la
-- service_role key; lectura pública vía URL). Correr una vez.
insert into storage.buckets (id, name, public)
values ('teia-productos', 'teia-productos', true)
on conflict (id) do nothing;

-- Storage: bucket PÚBLICO para los remitos PDF (el archivador sube con la service_role key;
-- los links públicos van al panel y al Sheet espejo). El path lleva un token HMAC no adivinable.
insert into storage.buckets (id, name, public)
values ('teia-remitos', 'teia-remitos', true)
on conflict (id) do nothing;
