-- Close direct browser-role access to internal trigger functions without
-- changing their trigger bindings or function bodies.

revoke execute on function public.create_review_update_cycle_after_finalization()
  from public, anon, authenticated;

-- This event-trigger function exists in the hosted project but is not part of
-- the repository schema. Keep fresh/local environments migration-compatible.
do $$
declare
  v_function regprocedure := to_regprocedure('public.rls_auto_enable()');
begin
  if v_function is not null then
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      v_function
    );
  end if;
end;
$$;

-- Preserve the existing trigger body while pinning name resolution to trusted
-- built-in objects. This function is also live-only in some environments.
do $$
declare
  v_function regprocedure := to_regprocedure('public.set_updated_at()');
begin
  if v_function is not null then
    execute format(
      'alter function %s set search_path = %L',
      v_function,
      ''
    );
  end if;
end;
$$;
