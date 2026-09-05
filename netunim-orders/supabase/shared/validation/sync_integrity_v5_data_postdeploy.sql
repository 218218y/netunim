-- Read-only live-data gate. Run only after both v5 clients have migrated and synced.
begin transaction read only;

do $data_postdeploy$
declare v_missing bigint;v_blank bigint;v_duplicate bigint;v_malformed bigint;
begin
  select
    count(*) filter(where jsonb_typeof(card)='object' and not card?'id'),
    count(*) filter(where jsonb_typeof(card)='object' and card?'id' and (
      jsonb_typeof(card->'id') is distinct from 'string' or nullif(btrim(card->>'id'),'') is null or card->>'id' is distinct from btrim(card->>'id'))),
    count(*) filter(where jsonb_typeof(card) is distinct from 'object')
  into v_missing,v_blank,v_malformed
  from public.kupa_documents document
  cross join lateral jsonb_array_elements(case when jsonb_typeof(document.state->'cards')='array' then document.state->'cards' else '[]'::jsonb end) item(card);
  select coalesce(sum(n-1),0) into v_duplicate from (
    select document.owner_id,document.document_name,btrim(item.card->>'id') id,count(*) n
    from public.kupa_documents document
    cross join lateral jsonb_array_elements(case when jsonb_typeof(document.state->'cards')='array' then document.state->'cards' else '[]'::jsonb end) item(card)
    where jsonb_typeof(item.card)='object' and jsonb_typeof(item.card->'id')='string' and nullif(btrim(item.card->>'id'),'') is not null
    group by document.owner_id,document.document_name,btrim(item.card->>'id') having count(*)>1
  ) duplicate_ids;
  if exists(select 1 from public.kupa_documents where jsonb_typeof(state->'cards') is distinct from 'array')
     or v_missing+v_blank+v_duplicate+v_malformed>0 then
    raise exception 'sync_integrity_v5_postdeploy_kupa_cards_invalid: missing=% blank_or_invalid=% duplicate_records=% malformed_records=%',v_missing,v_blank,v_duplicate,v_malformed;
  end if;
  raise notice 'PASS sync integrity v5 post-deploy data gate: no Kupa card is missing a stable ID';
end
$data_postdeploy$;

rollback;
