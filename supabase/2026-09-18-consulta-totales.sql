-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CONSULTA DE SOLO LECTURA — correrla ANTES de desplegar la v1.2 (no modifica nada).
--
-- Desde la v1.2 el panel marca en rojo, en la tarjeta del pedido:
--   · un pedido cuyo total no coincide con la suma de sus líneas con su descuento (± $1), y
--   · un pedido con el mismo producto en dos líneas.
-- Ninguna de las dos cosas debería existir, pero pudieron quedar de guardados a medias de la
-- versión anterior. Esto muestra QUÉ va a ver Mica marcado el día del deploy, para avisarle antes
-- (o revisar esos remitos) en vez de que se encuentre avisos rojos sin contexto.
-- El panel solo mira los 200 pedidos más recientes; esta consulta mira todos.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- 1 · Totales que no cuadran con sus líneas.
select o.id, o.order_number, o.status, o.created_at::date as fecha, o.client_name,
       o.total, o.discount_pct,
       coalesce(sum(i.line_total), 0) as suma_lineas,
       round(coalesce(sum(i.line_total), 0) * (1 - o.discount_pct / 100.0), 2) as total_esperado
  from teia_orders o
  left join teia_order_items i on i.order_id = o.id
 group by o.id
having abs(o.total - coalesce(sum(i.line_total), 0) * (1 - o.discount_pct / 100.0)) >= 1
 order by o.id desc;

-- 2 · El mismo producto en dos líneas de un pedido.
select i.order_id, o.order_number, o.status, i.product_id, min(i.name) as producto, count(*) as lineas
  from teia_order_items i
  join teia_orders o on o.id = i.order_id
 where i.product_id is not null
 group by i.order_id, o.order_number, o.status, i.product_id
having count(*) > 1
 order by i.order_id desc;
