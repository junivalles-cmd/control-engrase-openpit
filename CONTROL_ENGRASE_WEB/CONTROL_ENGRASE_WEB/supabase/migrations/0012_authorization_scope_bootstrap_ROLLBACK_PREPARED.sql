-- MANUAL-PRODUCTION-PREPARED rollback of 0012 ONLY BEFORE 0013 / cutover.
-- Preparation is not execution authorization. Apply manually as postgres.
-- Removing these two read-only helpers does not alter data,
-- RLS, grants on tables, or reopen any policy. Apply only after stopping
-- clients that require get_authorization_context().
-- Confirm 0013+ and all dependent policies/functions are absent. Do NOT use
-- this rollback after 0013, including after its rollback: 0013 rollback keeps
-- restrictive policies and both helpers are still required. Use the relevant
-- later safe-stop rollback instead; never remove those policies to allow this
-- script to run. PostgreSQL does not track every dependency in string-bodied
-- functions; review callers as well as catalog dependencies.
-- DROP uses RESTRICT (no CASCADE); a tracked dependency aborts the transaction
-- and preserves both helpers. Run the complete transaction, never just a DROP.
begin;
drop function if exists public.get_authorization_context();
drop function if exists public.resolve_authorization_scope(uuid);
commit;
