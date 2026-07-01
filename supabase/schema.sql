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
  sort_order          int  default 0,
  created_at          timestamptz not null default now()
);

create table if not exists teia_orders (
  id               bigint generated always as identity primary key,
  order_number     text unique,               -- ej. "TEIA-0042"
  client_name      text not null,
  client_contact   text not null,             -- WhatsApp o email
  delivery_address text not null,
  delivery_date    date,
  notes            text default '',
  status           text not null default 'pendiente',  -- pendiente|confirmado|entregado|anulado
  version          int  not null default 1,
  total            numeric(12,2) not null default 0,
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz
);

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

-- RLS: la app pega desde el server con la service_role key (la bypassa). Igual ACTIVAR RLS
-- para que la anon key no pueda leer/escribir nada directo (sin policies = todo denegado a anon).
alter table teia_products    enable row level security;
alter table teia_orders      enable row level security;
alter table teia_order_items enable row level security;
