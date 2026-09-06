-- Review candidate. Catalog reads need no RLS bypass. Browser grants remain explicit.
-- The function reports schema capability metadata, not owner/business data; it
-- intentionally has no auth.uid() dependency. Anonymous EXECUTE remains denied.
BEGIN;
ALTER FUNCTION public.get_netunim_sync_capabilities() SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.get_netunim_sync_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_netunim_sync_capabilities() TO authenticated, service_role;
COMMIT;
