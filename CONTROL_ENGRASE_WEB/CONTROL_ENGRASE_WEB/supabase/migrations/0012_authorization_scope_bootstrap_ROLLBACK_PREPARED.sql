-- PREPARED ONLY. Removing these two read-only helpers does not alter data,
-- RLS, grants on tables, or reopen any policy. Apply only after stopping
-- clients that require get_authorization_context().
begin;
drop function if exists public.get_authorization_context();
drop function if exists public.resolve_authorization_scope(uuid);
commit;
