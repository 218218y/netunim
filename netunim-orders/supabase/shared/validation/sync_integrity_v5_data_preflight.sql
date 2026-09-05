-- Read-only live-data preflight. Run on staging and production before applying v5.
-- It reports every malformed ID collection and permits only truly ID-less legacy
-- Kupa cards to continue to the client lineage migration.
begin transaction read only;

do $data_preflight$
declare
  v_document record;v_collection record;v_rows jsonb;v_missing bigint;v_blank bigint;
  v_duplicate bigint;v_malformed bigint;v_legacy_cards bigint:=0;v_blockers bigint:=0;
begin
  for v_document in
    select 'orders'::text domain,owner_id,document_name,state from public.order_management_documents
    union all select 'kupa',owner_id,document_name,state from public.kupa_documents
    union all select 'shared-checks',owner_id,document_name,state from public.shared_checks_documents
  loop
    for v_collection in
      select * from (values
        ('orders','suppliers',array['suppliers']),('orders','transactions',array['transactions']),
        ('orders','customerDebts',array['customerDebts']),('orders','customerOrders',array['customerOrders']),
        ('orders','serviceCalls',array['serviceCalls']),('orders','notes',array['notes']),
        ('orders','inventoryItems',array['inventoryItems']),('orders','inventoryEvents',array['inventoryEvents']),
        ('orders','warehouseOrders',array['warehouseOrders']),
        ('kupa','credits',array['credits']),('kupa','cash',array['cash']),('kupa','rights',array['rights']),
        ('kupa','notes',array['notes']),('kupa','expenses',array['expenses']),('kupa','cards',array['cards']),
        ('kupa','notesSheet.rows',array['notesSheet','rows']),('kupa','notesSheet.columns',array['notesSheet','columns']),
        ('shared-checks','checks',array['checks'])
      ) definition(domain,collection_name,path) where definition.domain=v_document.domain
    loop
      v_rows:=v_document.state#>v_collection.path;
      if v_rows is null then
        raise notice 'PREFLIGHT collection_absent domain=% owner=% document=% collection=% (client may normalize this to an empty collection)',v_document.domain,v_document.owner_id,v_document.document_name,v_collection.collection_name;
        continue;
      end if;
      if jsonb_typeof(v_rows) is distinct from 'array' then
        v_blockers:=v_blockers+1;
        raise notice 'PREFLIGHT BLOCKER collection_not_array domain=% owner=% document=% collection=%',v_document.domain,v_document.owner_id,v_document.document_name,v_collection.collection_name;
        continue;
      end if;
      select
        count(*) filter(where jsonb_typeof(value)='object' and not value?'id'),
        count(*) filter(where jsonb_typeof(value)='object' and value?'id' and (
          jsonb_typeof(value->'id') is distinct from 'string' or nullif(btrim(value->>'id'),'') is null or value->>'id' is distinct from btrim(value->>'id'))),
        count(*) filter(where jsonb_typeof(value) is distinct from 'object')
      into v_missing,v_blank,v_malformed from jsonb_array_elements(v_rows);
      select coalesce(sum(n-1),0) into v_duplicate from (
        select count(*) n from jsonb_array_elements(v_rows) row(value)
        where jsonb_typeof(value)='object' and jsonb_typeof(value->'id')='string' and nullif(btrim(value->>'id'),'') is not null
        group by btrim(value->>'id') having count(*)>1
      ) duplicate_ids;
      if v_collection.collection_name='cards' then
        v_legacy_cards:=v_legacy_cards+v_missing;
        v_blockers:=v_blockers+v_blank+v_duplicate+v_malformed;
        if v_missing+v_blank+v_duplicate+v_malformed>0 then raise notice 'PREFLIGHT Kupa cards owner=% document=% legacy_missing=% blank_or_invalid=% duplicate_records=% malformed_records=%',v_document.owner_id,v_document.document_name,v_missing,v_blank,v_duplicate,v_malformed;end if;
      else
        v_blockers:=v_blockers+v_missing+v_blank+v_duplicate+v_malformed;
        if v_missing+v_blank+v_duplicate+v_malformed>0 then raise notice 'PREFLIGHT BLOCKER domain=% owner=% document=% collection=% missing=% blank_or_invalid=% duplicate_records=% malformed_records=%',v_document.domain,v_document.owner_id,v_document.document_name,v_collection.collection_name,v_missing,v_blank,v_duplicate,v_malformed;end if;
      end if;
    end loop;
  end loop;
  raise notice 'PREFLIGHT legacy Kupa cards without an id: %',v_legacy_cards;
  raise notice 'PREFLIGHT pending compatibility: browser outboxes are client-local and cannot be counted from PostgreSQL; v5 accepts pre-v5 baseState/snapshot with an ID-less remote only when ordered lineage is unambiguous, otherwise it persists legacy-card-migration-conflict. Do not clear browser storage while pending work exists.';
  if v_blockers>0 then raise exception 'sync_integrity_v5_data_preflight_blocked: % unsafe ID issue(s)',v_blockers;end if;
  raise notice 'PASS sync integrity v5 data preflight; compatible legacy Kupa cards=%',v_legacy_cards;
end
$data_preflight$;

rollback;
