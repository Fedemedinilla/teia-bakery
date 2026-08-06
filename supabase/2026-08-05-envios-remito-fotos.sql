-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  Teia Bakery — migración del 05/08/2026
--  Envíos y mínimos · remito con saldo y envío · recorte de fotos · CUIT + contraseña
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--  CÓMO SE CORRE: Supabase → SQL Editor → pegar TODO → Run. Una sola vez.
--
--  Es idempotente: se puede correr dos veces sin romper nada. No borra, no pisa, no enciende
--  nada. Todo lo que agrega es opcional para el código que ya está en producción, así que se
--  puede correr AHORA aunque el código nuevo todavía no esté deployado.
--
--  Al final hay una consulta de verificación. Correla y fijate que devuelva 5 filas.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ── 1. Ajustes editables desde el panel ────────────────────────────────────────────────────
-- Clave/valor. Reemplaza a dos env vars de Vercel (TEIA_MIN_ORDER y TEIA_REQUIRE_CODE): a partir
-- de acá esos dos números se cambian desde /administradora, sin redeploy.
create table if not exists teia_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table teia_settings enable row level security;

-- Los valores que dio la clienta. `do nothing` = si volvés a correr esto, NO le pisa los
-- cambios que ella haya hecho desde el panel.
-- OJO: require_code arranca en 'false' a propósito. Correr este SQL NO obliga a nadie a usar
-- contraseña; eso se enciende aparte, desde el panel, cuando todas las cuentas tengan una.
insert into teia_settings (key, value) values
  ('envio_min_general', '140000'),
  ('envio_min_chungo',  '250000'),
  ('require_code',      'false')
on conflict (key) do nothing;


-- ── 2. Remito: saldo anterior y costo de envío ─────────────────────────────────────────────
-- Los dos montos que ella carga al confirmar el pedido. NULL = no cargado → el PDF imprime el
-- renglón en blanco para completarlo a mano, igual que su planilla.
-- No entran en `total`: `total` sigue siendo la mercadería, que es lo que suma el Sheet espejo.
alter table teia_orders add column if not exists saldo_anterior numeric(12,2);
alter table teia_orders add column if not exists costo_envio    numeric(12,2);


-- ── 3. Recorte de fotos: se guarda la original aparte ──────────────────────────────────────
-- `image_url` pasa a ser el recorte cuadrado que ve el cliente. La original queda acá para poder
-- reencuadrar de nuevo sin perder calidad. Los productos que ya están cargados no necesitan
-- backfill: la primera vez que se recorte uno, el panel copia su URL actual acá antes de pisarla.
alter table teia_products add column if not exists image_original_url text;


-- ── 4. Contraseña por comercio (2º factor) ─────────────────────────────────────────────────
-- Probablemente ya la corriste; si es así, esta línea no hace nada. Va igual porque es el
-- prerrequisito duro de encender CUIT + contraseña: sin la columna, al encenderlo NO ENTRA NADIE.
alter table teia_clients add column if not exists access_code text;


-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  VERIFICACIÓN — correr esto y confirmar que devuelve 5 filas
-- ═══════════════════════════════════════════════════════════════════════════════════════════
select 'teia_settings (tabla)' as que, count(*)::text as detalle
  from information_schema.tables where table_name = 'teia_settings'
union all
select 'teia_orders.saldo_anterior', count(*)::text from information_schema.columns
  where table_name = 'teia_orders' and column_name = 'saldo_anterior'
union all
select 'teia_orders.costo_envio', count(*)::text from information_schema.columns
  where table_name = 'teia_orders' and column_name = 'costo_envio'
union all
select 'teia_products.image_original_url', count(*)::text from information_schema.columns
  where table_name = 'teia_products' and column_name = 'image_original_url'
union all
select 'teia_clients.access_code', count(*)::text from information_schema.columns
  where table_name = 'teia_clients' and column_name = 'access_code';
-- Las 5 filas tienen que decir 1. Si alguna dice 0, algo no se creó: mandámela y lo miro.


-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  CUÁNTAS CUENTAS QUEDARÍAN AFUERA si encendés CUIT + contraseña
--  (informativa: no cambia nada. Tiene que dar 0 antes de encenderlo.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
select count(*) as cuentas_activas_sin_contrasenia
  from teia_clients
 where active is not false
   and (access_code is null or btrim(access_code) = '');
