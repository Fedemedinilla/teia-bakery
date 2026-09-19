-- ═══════════════════════════════════════════════════════════════════════════════════════════
--  Teia Bakery — migración del 18/09/2026
--  Envío sin cargo con excepción POR COMERCIO (Chungo Pilar)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--  CÓMO SE CORRE: Supabase → SQL Editor → New query → pegar SOLO este bloque → Run.
--  (La verificación va aparte, más abajo: es una consulta distinta.)
--
--  QUÉ HACE: agrega a cada comercio un monto propio de envío sin cargo, opcional.
--    · vacío (null) = usa el de su lista, como hasta ahora
--    · 0            = envío sin cargo siempre, para ese comercio
--    · otro número  = su propio mínimo (ej. Chungo Pilar: 250000)
--
--  Es una sola columna. Idempotente, no borra nada, y arranca VACÍA para todos: correrlo NO cambia
--  nada de lo que se ve hoy. El monto de Pilar lo carga Mica desde su ficha en el panel.
--
--  El código funciona SIN esta columna: mientras no exista, todos los comercios usan el de su
--  lista y el campo nuevo de la ficha no se puede guardar. Igual conviene correrlo ANTES del
--  deploy, para que el campo ande desde el primer minuto.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

alter table teia_clients add column if not exists envio_min integer;

do $$
begin
  alter table teia_clients
    add constraint teia_clients_envio_min_no_negativo check (envio_min is null or envio_min >= 0);
exception when duplicate_object then null;  -- ya estaba: correrlo dos veces no hace nada
end $$;

-- Verificación (correr aparte, en otra query):
select 'teia_clients.envio_min' as que, count(*)::text as detalle
  from information_schema.columns
 where table_name = 'teia_clients' and column_name = 'envio_min';
-- Tiene que decir 1.
