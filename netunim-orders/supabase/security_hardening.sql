-- Supabase Security Advisor hardening
-- rls_auto_enable is an event-trigger helper and is not an application RPC.
-- Revoking client EXECUTE does not remove the event trigger; it only closes direct API invocation.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
