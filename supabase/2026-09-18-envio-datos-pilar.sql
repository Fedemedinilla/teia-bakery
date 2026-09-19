-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  Teia Bakery — DATOS del 18/09/2026: Chungo en $140.000, solo Chungo Pilar en $250.000
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--  ⚠️ VA DESPUÉS de dos cosas: el SQL de la columna (2026-09-18-envio-por-comercio.sql) y el
--  DEPLOY del código nuevo. Si se corre antes del deploy, el código viejo ignora el monto de Pilar,
--  y hasta que salga el deploy pasan DOS cosas:
--    · Pilar ve en su catálogo "llega a los $140.000" (le promete envío sin cargo que no tiene).
--    · El panel VIEJO le dice a Mica "Llega a $140.000: envío sin cargo" en los pedidos de Pilar
--      de entre $140.000 y $250.000. Si confirma uno en esa ventana, no le cobra un envío que sí
--      correspondía. O sea: en esa ventana, a Pilar se le cobra el envío por debajo de $250.000
--      aunque el panel diga otra cosa.
--
--  Son TRES secciones. Las dos primeras solo LEEN; la tercera es la que cambia algo, y hay que
--  editarla antes de correrla. ⚠️ La sección 2 tiene CUATRO consultas: corrélas DE A UNA
--  (seleccioná una y Run). Si pegás la sección entera, el editor de Supabase muestra solo el
--  resultado de la última.
--
--  Alternativa sin SQL: Mica lo hace desde el panel, EN ESTE ORDEN — primero pone 250000 en la
--  ficha de Chungo Pilar (pestaña Clientes), después baja Chungo a 140000 (pestaña Envíos). Al
--  revés, Pilar pasa un rato viendo $140.000. Aun por ese camino, la consulta 2 (solo lee) hay que
--  correrla igual: es la única forma de saber a qué pedidos se les cobró el envío de más.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ─── 1 · ¿Cuál es Chungo Pilar? (solo lee) ──────────────────────────────────────────────────
--  Se identifica por id, NUNCA por nombre: un `ilike '%pilar%'` podría agarrar otro local o no
--  agarrar ninguno. Anotá el `id` de Pilar para las consultas 2 y 3.

select id, cuit, business_name, catalog, active, envio_min
  from teia_clients
 where catalog = 'chungo'
 order by business_name;


-- ─── 2 · Pedidos donde se pudo haber cobrado el envío DE MÁS (solo lee) ──────────────────────
--  Desde agosto, TODOS los locales de Chungo veían "no llega a $250.000", cuando el monto real
--  (salvo Pilar) era $140.000. Son los pedidos de Chungo, de un local que NO es Pilar, de entre
--  $140.000 y $250.000. Qué se hace con cada uno (una nota de crédito, un aviso, nada) lo decide
--  Mica. Reemplazá <ID_DE_PILAR> por el id de la consulta 1 en las tres primeras.
--  Todas miran desde el 6/8/2026: ese día entraron el monto de $250.000 para Chungo y el renglón
--  del envío en el remito. Antes no había regla de envío que pudiera haber cobrado de más.

-- 2a · Confirmados con el envío CARGADO en la app: salió cobrado en el remito.
select o.order_number, o.created_at::date as fecha, c.business_name, o.total, o.costo_envio, o.status
  from teia_orders o
  join teia_clients c on c.id = o.client_id
 where c.catalog = 'chungo'
   and c.id <> <ID_DE_PILAR>
   and o.total >= 140000 and o.total < 250000
   and coalesce(o.costo_envio, 0) > 0
   and o.status in ('confirmado', 'entregado')
   and o.created_at >= '2026-08-06'
 order by o.created_at;

-- 2b · Confirmados SIN envío cargado en la app: el remito imprimía el renglón "Costo de envío" en
--  blanco para completarlo a mano, así que el envío pudo haberse cobrado en el papel. Estos hay que
--  revisarlos con los remitos impresos (o preguntarle a Mica); la base no lo puede saber.
select o.order_number, o.created_at::date as fecha, c.business_name, o.total, o.costo_envio, o.status
  from teia_orders o
  join teia_clients c on c.id = o.client_id
 where c.catalog = 'chungo'
   and c.id <> <ID_DE_PILAR>
   and o.total >= 140000 and o.total < 250000
   and coalesce(o.costo_envio, 0) = 0
   and o.status in ('confirmado', 'entregado')
   and o.created_at >= '2026-08-06'
 order by o.created_at;

-- 2c · PENDIENTES que ya tienen el envío cargado con la regla vieja: todavía se corrige solo, desde
--  el panel, sacándole el costo de envío antes de confirmarlos.
select o.order_number, o.created_at::date as fecha, c.business_name, o.total, o.costo_envio, o.status
  from teia_orders o
  join teia_clients c on c.id = o.client_id
 where c.catalog = 'chungo'
   and c.id <> <ID_DE_PILAR>
   and o.total >= 140000 and o.total < 250000
   and coalesce(o.costo_envio, 0) > 0
   and o.status = 'pendiente'
 order by o.created_at;

--  Lo que las consultas de arriba NO ven: los pedidos de una cuenta que después se BORRÓ (el pedido
--  sobrevive pero pierde su client_id, así que ya no se sabe de qué lista era). Si alguna vez se
--  borró un local de Chungo, estos son los candidatos, por nombre, con y sin envío cargado —
--  revisalos a ojo, porque puede aparecer alguno de Pilar:
select o.order_number, o.created_at::date as fecha, o.client_name, o.total, o.costo_envio, o.status
  from teia_orders o
 where o.client_id is null
   and o.client_name ilike '%chungo%'
   and o.total >= 140000 and o.total < 250000
   and o.status in ('pendiente', 'confirmado', 'entregado')
   and o.created_at >= '2026-08-06'
 order by o.created_at;


-- ─── 3 · El cambio (ESTE es el que modifica) ─────────────────────────────────────────────────
--  Reemplazá <ID_DE_PILAR> por el id de la consulta 1 (UNA sola vez, en la primera línea del
--  bloque). Si te olvidás, da error de sintaxis y NO cambia nada: está hecho así a propósito.
--
--  Es un solo bloque: o se hacen las dos cosas, o ninguna. Primero Pilar, después la lista.
--  FRENA, sin cambiar nada, si:
--    · el id no es un comercio de la lista Chungo (un dígito mal copiado);
--    · el id es de OTRO local de Chungo. El id elige; el nombre solo CONFIRMA que es Pilar. Antes
--      frenaba solo lo primero, y el id de Chungo Local Dos dejaba Local Dos en $250.000, Pilar sin su
--      monto y la verificación de abajo diciendo "Chungo Pilar: 250000". Si el nombre real de
--      Pilar en la base no dice "pilar", cambiá '%pilar%' por una palabra de su nombre.
--  Se puede volver a correr: si Pilar ya tiene un monto propio (el de este SQL o uno que Mica
--  cambió después), no se toca. La lista solo se baja si todavía dice 250000.

do $$
declare
  pilar_id bigint := <ID_DE_PILAR>;
  nombre   text;
  actual   integer;
begin
  select business_name, envio_min into nombre, actual
    from teia_clients
   where id = pilar_id and catalog = 'chungo';
  if not found then
    raise exception 'El id % no es un comercio de la lista Chungo. No se cambió nada.', pilar_id;
  end if;
  if nombre not ilike '%pilar%' then
    raise exception 'El id % es "%", no Chungo Pilar. No se cambió nada: revisá el id en la consulta 1.', pilar_id, nombre;
  end if;

  if actual is null then
    update teia_clients set envio_min = 250000 where id = pilar_id;
  else
    raise notice 'Chungo Pilar ya tenía un monto propio ($%): no se tocó.', actual;
  end if;

  update teia_settings set value = '140000', updated_at = now()
   where key = 'envio_min_chungo' and value = '250000';
end $$;

-- Verificación (correr aparte): el nombre que sale es el de la BASE, no uno escrito acá. Tiene que
-- ser Chungo Pilar con 250000, y la lista Chungo en 140000.
select business_name as que, envio_min::text as valor from teia_clients where id = <ID_DE_PILAR>
union all
select key, value from teia_settings where key like 'envio_min_%';
