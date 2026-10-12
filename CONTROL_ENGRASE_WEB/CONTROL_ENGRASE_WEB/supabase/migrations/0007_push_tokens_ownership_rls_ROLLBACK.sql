-- Deliberately non-executable safety stop.
-- Removing the owner-only restrictive policies would reopen token disclosure,
-- cross-account mutation, or hard deletion through the existing store matrix.
-- No automatic rollback is safe. Recover by preparing and reviewing a forward
-- fix that preserves per-row ownership; do not restore 0002's broad policies.
do $$ begin
  raise exception 'No safe automatic rollback for push-token ownership RLS; prepare a reviewed forward fix';
end $$;
