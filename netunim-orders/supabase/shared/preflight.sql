-- PRE-FLIGHT READ ONLY — להריץ רק אחרי הקפאת עבודה בשתי האפליקציות.
-- אין בקובץ UPDATE/INSERT/DELETE/DDL. אם assertion נכשל: לא מריצים cutover.sql.

set statement_timeout = '60s';

do $preflight$
declare
  v_kupa_count integer;
  v_orders_count integer;
  v_shared_conflict boolean := false;
begin
  if to_regclass('public.kupa_documents') is null
     or to_regclass('public.order_management_documents') is null then
    raise exception 'preflight_missing_source_tables';
  end if;


  if to_regclass('public.kupa_document_backups') is null
     or to_regclass('public.kupa_periodic_backups') is null
     or to_regclass('public.order_management_document_backups') is null
     or to_regclass('public.order_management_periodic_backups') is null then
    raise exception 'preflight_missing_backup_tables';
  end if;

  if exists (
    select 1 from public.kupa_document_backups
    group by owner_id, document_name, revision having count(*) > 1
  ) or exists (
    select 1 from public.kupa_periodic_backups
    group by owner_id, document_name, revision having count(*) > 1
  ) or exists (
    select 1 from public.order_management_document_backups
    group by owner_id, document_name, revision having count(*) > 1
  ) or exists (
    select 1 from public.order_management_periodic_backups
    group by owner_id, document_name, revision having count(*) > 1
  ) then
    raise exception 'preflight_duplicate_backup_revision';
  end if;

  select count(*) into v_kupa_count
  from public.kupa_documents where document_name='main';
  select count(*) into v_orders_count
  from public.order_management_documents where document_name='suppliers';
  if v_kupa_count = 0 or v_orders_count = 0 then
    raise exception 'preflight_missing_source_document';
  end if;

  if exists (
    select 1
    from (select owner_id from public.kupa_documents where document_name='main') k
    full join (select owner_id from public.order_management_documents where document_name='suppliers') o using(owner_id)
    where k.owner_id is null or o.owner_id is null
  ) then
    raise exception 'preflight_owner_mismatch_between_kupa_and_orders';
  end if;

  if exists (
    select 1 from public.kupa_documents d
    where d.document_name='main' and (
      jsonb_typeof(d.state) is distinct from 'object'
      or jsonb_typeof(d.state->'checks') is distinct from 'array'
      or jsonb_typeof(d.state->'credits') is distinct from 'array'
      or jsonb_typeof(d.state->'cash') is distinct from 'array'
      or jsonb_typeof(d.state->'expenses') is distinct from 'array'
      or jsonb_typeof(d.state->'cards') is distinct from 'array'
      or jsonb_typeof(d.state->'bank') is distinct from 'object'
      or jsonb_typeof(d.state#>'{bank,adjustments}') is distinct from 'array'
    )
  ) then
    raise exception 'preflight_invalid_kupa_shape';
  end if;

  if exists (
    select 1 from public.order_management_documents d
    where d.document_name='suppliers' and (
      jsonb_typeof(d.state) is distinct from 'object'
      or jsonb_typeof(d.state->'checks') is distinct from 'array'
      or jsonb_typeof(d.state->'suppliers') is distinct from 'array'
      or jsonb_typeof(d.state->'transactions') is distinct from 'array'
      or jsonb_typeof(d.state->'customerDebts') is distinct from 'array'
      or jsonb_typeof(d.state->'customerOrders') is distinct from 'array'
      or jsonb_typeof(d.state->'serviceCalls') is distinct from 'array'
      or jsonb_typeof(d.state->'inventoryItems') is distinct from 'array'
      or jsonb_typeof(d.state->'inventoryCategoryOrder') is distinct from 'array'
      or jsonb_typeof(d.state->'inventoryEvents') is distinct from 'array'
      or jsonb_typeof(d.state->'warehouseOrders') is distinct from 'array'
      or jsonb_typeof(d.state->'notes') is distinct from 'array'
    )
  ) then
    raise exception 'preflight_invalid_order_shape';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    join public.order_management_documents o on o.owner_id=k.owner_id
    where k.document_name='main' and o.document_name='suppliers'
      and k.state->'checks' is distinct from o.state->'checks'
  ) then
    raise exception 'preflight_checks_not_identical_between_sources';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    cross join lateral jsonb_array_elements(k.state->'checks') c
    where k.document_name='main' and (
      jsonb_typeof(c) is distinct from 'object'
      or nullif(btrim(c->>'id'),'') is null
      or jsonb_typeof(c->'amount') is distinct from 'number'
      or jsonb_typeof(c->'dueDate') is distinct from 'string'
      or jsonb_typeof(c->'status') is distinct from 'string'
      or c->>'status' not in ('בקופה','הופקד - במעקב','נפרע','חזר','בוטל')
    )
  ) then
    raise exception 'preflight_invalid_check_record';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    cross join lateral jsonb_array_elements(k.state->'checks') c
    where k.document_name='main'
    group by k.owner_id, c->>'id'
    having count(*) > 1
  ) then
    raise exception 'preflight_duplicate_check_id';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    cross join lateral jsonb_array_elements(k.state#>'{bank,adjustments}') a
    where k.document_name='main' and a->>'type'='check_deposit'
  ) then
    raise exception 'preflight_legacy_check_deposit_adjustment_exists';
  end if;

  -- לפני freeze יש ללחוץ בקופה על שמירת יתרת עו"ש חדשה.
  -- חלון של שעתיים מונע מעבר עם baseline ישן בטעות.
  if exists (
    select 1 from public.kupa_documents k
    where k.document_name='main' and (
      k.state#>>'{bank,updatedAt}' is null
      or (k.state#>>'{bank,updatedAt}')::timestamptz < clock_timestamp() - interval '2 hours'
      or jsonb_typeof(k.state#>'{bank,currentBalance}') is distinct from 'number'
    )
  ) then
    raise exception 'preflight_bank_snapshot_not_fresh';
  end if;

  -- אם shared_checks_documents כבר נוצר בעבר, אסור שיהיה בו תוכן שסותר את המקור הישן.
  if to_regclass('public.shared_checks_documents') is not null then
    execute $q$
      select exists (
        select 1
        from public.shared_checks_documents s
        join public.kupa_documents k on k.owner_id=s.owner_id
        where s.document_name='main' and k.document_name='main'
          and s.state->'checks' is distinct from k.state->'checks'
      )
    $q$ into v_shared_conflict;
    if v_shared_conflict then
      raise exception 'preflight_existing_shared_checks_conflict';
    end if;
    if exists (select 1 from public.shared_checks_documents s where s.document_name='main' and jsonb_typeof(s.state->'bankEvents')='array' and jsonb_array_length(s.state->'bankEvents')>0) then
      raise exception 'preflight_existing_shared_bank_events_not_empty';
    end if;
  end if;
end
$preflight$;

-- פלט אנושי להשוואה לפני cutover. שמור צילום מסך/העתק של התוצאה.
select
  k.owner_id,
  k.revision as kupa_revision,
  o.revision as orders_revision,
  jsonb_array_length(k.state->'checks') as checks_count,
  md5((k.state->'checks')::text) as checks_hash,
  k.state#>>'{bank,asOfDate}' as bank_as_of_date,
  k.state#>>'{bank,updatedAt}' as bank_snapshot_at,
  k.updated_at as kupa_cloud_updated_at,
  o.updated_at as orders_cloud_updated_at
from public.kupa_documents k
join public.order_management_documents o on o.owner_id=k.owner_id
where k.document_name='main' and o.document_name='suppliers'
order by k.owner_id;
