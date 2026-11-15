begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
-- Export the exact bytes whose hash was captured, rather than reconstructing
-- PostgreSQL JSONB serialization in the browser. Owner and MFA scope stay intact.
create function public.export_finance_document_version(p_document_name text,p_revision bigint)
returns table(revision bigint,state_text text,state_hash text)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
begin
 perform netunim_internal.require_financial_mfa_v1();
 return query select v.revision,v.state::text,v.state_hash from netunim_internal.finance_document_versions v
 where v.owner_id=auth.uid() and v.document_name=p_document_name and v.revision=p_revision;
end $f$;
revoke all on function public.export_finance_document_version(text,bigint) from public,anon;
grant execute on function public.export_finance_document_version(text,bigint) to authenticated;
commit;
