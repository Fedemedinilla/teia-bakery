-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  Teia Bakery — migración del 08/08/2026
--  Elegir qué entradas de "Información" se ven también al confirmar el pedido
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--  CÓMO SE CORRE: Supabase → SQL Editor → New query → pegar SOLO este bloque → Run.
--  (La verificación va aparte, más abajo: es una consulta distinta.)
--
--  Es una sola columna. Idempotente, no borra nada, y arranca en `true` para TODAS las entradas:
--  correrlo NO cambia lo que se ve hoy. A partir de acá, Mica destilda desde el panel las que no
--  quiera repetir en la última pantalla (por ejemplo la duración de los productos).
--
--  El código ya está deployado y funciona SIN esta columna: mientras no exista, se muestran
--  todas, como hasta ahora. O sea que no hay apuro ni ventana de riesgo.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

alter table teia_info add column if not exists en_checkout boolean not null default true;
-- Verificación (correr aparte, en otra query):
select 'teia_info.en_checkout' as que, count(*)::text as detalle
  from information_schema.columns
 where table_name = 'teia_info' and column_name = 'en_checkout';
-- Tiene que decir 1.
