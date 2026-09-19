-- Teia Bakery · Tarea 3 (19/9): la administradora arma pedidos a nombre de un comercio
-- ("🛒 Armar pedido" y "↻ Repetir", en /administradora/armar).
--
-- CORRER ANTES DEL DEPLOY, en el SQL Editor de Supabase, entero y de una vez. Es idempotente: se
-- puede volver a correr sin romper nada. No toca ningún dato existente.
--
-- Qué agrega:
--   · teia_orders.placed_by  → 'teia' si lo cargó la administradora; null si lo hizo el comercio.
--   · teia_orders.armado_id  → la clave de UN armado (la genera la página). Única: si el mismo armado
--                              llega dos veces (un reintento sin respuesta, el botón atrás, dos
--                              toques), el segundo devuelve el pedido del primero en vez de duplicarlo.
--   · teia_armar_pedido(p)   → graba el pedido Y sus líneas en UNA transacción: o entra todo o no
--                              entra nada. Nunca queda un pedido sin líneas.
--
-- Sin este SQL, lo único que no anda es "Armar pedido": la página lo dice y no crea nada. El resto
-- de la app (los pedidos de los comercios, el panel, el Sheet) no nombra estas columnas.

alter table teia_orders add column if not exists placed_by text;
alter table teia_orders add column if not exists armado_id text;
do $$ begin
  alter table teia_orders add constraint teia_orders_placed_by_valido check (placed_by is null or placed_by = 'teia');
exception when duplicate_object then null; end $$;
create unique index if not exists teia_orders_armado_id_unico on teia_orders (armado_id) where armado_id is not null;

-- La función la llama SOLO el servidor (/api/admin/armar, con la service_role), después de validar
-- todo: la cuenta, la lista, los precios leídos de la base y el total. Acá no se vuelve a validar la
-- plata; se garantiza lo que el servidor no puede garantizar solo: que el pedido y sus líneas entren
-- juntos, y que un mismo armado no entre dos veces.
create or replace function public.teia_armar_pedido(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_armado text := p->>'armado_id';
  v_id     bigint;
  v_num    text;
  v_total  numeric;
  v_pct    int;
  v_status text;
  v_cli    bigint;
  v_huella text;
begin
  if v_armado is null or v_armado !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'armado_id inválido' using errcode = '22023';
  end if;

  -- El mismo armado ya se grabó: se devuelve ESE pedido, sin crear otro, con la huella de lo que
  -- tiene (producto × cantidad, ordenado por producto) para que el servidor la compare con lo que
  -- llega ahora. Si ella cambió algo y volvió a mandar el mismo armado, el servidor NO puede decirle
  -- "listo": lo nuevo no se guardó (auditoría de la tarea 3, 19/9).
  select id, order_number, total, discount_pct, status, client_id into v_id, v_num, v_total, v_pct, v_status, v_cli
    from teia_orders where armado_id = v_armado;
  if found then
    select coalesce(string_agg(product_id::text || 'x' || qty::text, ',' order by product_id, qty), '') into v_huella
      from teia_order_items where order_id = v_id;
    return jsonb_build_object('id', v_id, 'order_number', v_num, 'total', v_total, 'discount_pct', v_pct,
      'status', v_status, 'client_id', v_cli, 'huella', v_huella, 'repetido', true);
  end if;
  -- Solo buscar: el servidor pregunta ANTES de validar precios, para no contestar "no se creó nada"
  -- sobre un armado que sí se creó en un intento cuya respuesta se perdió.
  if coalesce((p->>'solo_buscar')::boolean, false) then
    return null;
  end if;

  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'el pedido no tiene líneas' using errcode = '22023';
  end if;

  begin
    insert into teia_orders (client_id, client_name, client_contact, delivery_address, delivery_date,
                             notes, status, version, total, discount_pct, placed_by, armado_id)
    values ((p->>'client_id')::bigint, p->>'client_name', p->>'client_contact', p->>'delivery_address',
            nullif(p->>'delivery_date', '')::date, coalesce(p->>'notes', ''), 'pendiente', 1,
            (p->>'total')::numeric, coalesce((p->>'discount_pct')::int, 0), 'teia', v_armado)
    returning id into v_id;
  exception when unique_violation then
    -- Dos llamadas A LA VEZ con el mismo armado: esta esperó a la otra, que ya lo grabó. Si la clave
    -- repetida NO era la del armado (otra, por ejemplo la del id), el error sigue su camino: devolver
    -- "repetido" sin pedido haría que el servidor dijera "listo" sobre algo que no existe.
    select id, order_number, total, discount_pct, status, client_id into v_id, v_num, v_total, v_pct, v_status, v_cli
      from teia_orders where armado_id = v_armado;
    if not found then
      raise;
    end if;
    select coalesce(string_agg(product_id::text || 'x' || qty::text, ',' order by product_id, qty), '') into v_huella
      from teia_order_items where order_id = v_id;
    return jsonb_build_object('id', v_id, 'order_number', v_num, 'total', v_total, 'discount_pct', v_pct,
      'status', v_status, 'client_id', v_cli, 'huella', v_huella, 'repetido', true);
  end;

  -- Si una línea falla (un producto que se borró recién, un dato inválido), la excepción deshace
  -- también el INSERT de arriba: no queda un pedido sin líneas.
  insert into teia_order_items (order_id, product_id, name, pack_label, qty, unit_price, line_total)
  select v_id, (i->>'product_id')::bigint, i->>'name', coalesce(i->>'pack_label', ''),
         (i->>'qty')::int, (i->>'unit_price')::numeric, (i->>'line_total')::numeric
  from jsonb_array_elements(p->'items') as i;

  -- Mismo número que /api/order ('TEIA-' + id con al menos 4 cifras). lpad sola RECORTA: lpad('12345', 4)
  -- da '1234', y el pedido 12345 se llamaría como el 1234.
  v_num := 'TEIA-' || case when v_id < 1000 then lpad(v_id::text, 4, '0') else v_id::text end;
  update teia_orders set order_number = v_num where id = v_id returning total, discount_pct, client_id into v_total, v_pct, v_cli;
  select coalesce(string_agg(product_id::text || 'x' || qty::text, ',' order by product_id, qty), '') into v_huella
    from teia_order_items where order_id = v_id;

  return jsonb_build_object('id', v_id, 'order_number', v_num, 'total', v_total, 'discount_pct', v_pct,
    'status', 'pendiente', 'client_id', v_cli, 'huella', v_huella, 'repetido', false);
end $$;

-- Solo la service_role (el servidor) la puede llamar. Supabase le da EXECUTE a anon y authenticated
-- por defecto en las funciones nuevas: se les saca. (Igual correría con los permisos del que llama, y
-- RLS sin policies le niega a anon cualquier INSERT: esto es la segunda llave.)
revoke all on function public.teia_armar_pedido(jsonb) from public;
do $$ begin
  execute 'revoke all on function public.teia_armar_pedido(jsonb) from anon, authenticated';
exception when undefined_object then null; end $$;
grant execute on function public.teia_armar_pedido(jsonb) to service_role;

-- Que la API vea la función nueva sin esperar.
notify pgrst, 'reload schema';

-- Verificación (correr aparte, después): tiene que dar columnas = 2, indice = 1, funcion = 1,
-- anon_puede = false.
-- select
--   (select count(*) from information_schema.columns
--     where table_name = 'teia_orders' and column_name in ('placed_by', 'armado_id')) as columnas,
--   (select count(*) from pg_indexes where indexname = 'teia_orders_armado_id_unico') as indice,
--   (select count(*) from pg_proc where proname = 'teia_armar_pedido') as funcion,
--   has_function_privilege('anon', 'public.teia_armar_pedido(jsonb)', 'execute') as anon_puede;
