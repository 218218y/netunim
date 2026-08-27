-- POST-FLIGHT READ ONLY — להריץ מיד אחרי cutover.sql ולפני פתיחת שתי האפליקציות לעובדים.
-- אין בקובץ UPDATE/INSERT/DELETE/DDL. כשל כלשהו = לא פותחים עבודה; בודקים/משחזרים לפני המשך.
-- הבדיקה מניחה שעדיין לא בוצעו שינויים עסקיים לאחר ה-cutover ולכן bankEvents חייב להיות ריק.

set statement_timeout = '60s';

do $postflight$
declare
  v_missing text;
  v_seq_last bigint;
begin
  -- כל אובייקטי הליבה חייבים להיות קיימים.
  select string_agg(x.name, ', ' order by x.name) into v_missing
  from (values
    ('public.kupa_documents'),
    ('public.kupa_document_backups'),
    ('public.kupa_periodic_backups'),
    ('public.order_management_documents'),
    ('public.order_management_document_backups'),
    ('public.order_management_periodic_backups'),
    ('public.shared_checks_documents'),
    ('public.shared_checks_document_backups'),
    ('public.shared_checks_periodic_backups')
  ) as x(name)
  where to_regclass(x.name) is null;
  if v_missing is not null then
    raise exception 'postflight_missing_tables: %', v_missing;
  end if;
  if to_regclass('public.shared_financial_event_seq') is null then
    raise exception 'postflight_missing_financial_sequence';
  end if;

  -- לכל owner חייב להיות בדיוק מסמך חי אחד מכל דומיין, עם אותו owner.
  if exists (
    select 1
    from (
      select owner_id,
             count(*) filter (where source='kupa') as kupa_n,
             count(*) filter (where source='orders') as orders_n,
             count(*) filter (where source='checks') as checks_n
      from (
        select owner_id,'kupa'::text source from public.kupa_documents where document_name='main'
        union all
        select owner_id,'orders' from public.order_management_documents where document_name='suppliers'
        union all
        select owner_id,'checks' from public.shared_checks_documents where document_name='main'
      ) q
      group by owner_id
    ) x
    where x.kupa_n<>1 or x.orders_n<>1 or x.checks_n<>1
  ) then
    raise exception 'postflight_live_document_owner_mismatch';
  end if;

  -- חוזה live: checks קיים רק בדומיין המשותף.
  if exists (
    select 1 from public.kupa_documents d
    where d.document_name='main' and (
      d.state ? 'checks'
      or jsonb_typeof(d.state) is distinct from 'object'
      or jsonb_typeof(d.state->'credits') is distinct from 'array'
      or jsonb_typeof(d.state->'cash') is distinct from 'array'
      or jsonb_typeof(d.state->'expenses') is distinct from 'array'
      or jsonb_typeof(d.state->'cards') is distinct from 'array'
      or jsonb_typeof(d.state->'bank') is distinct from 'object'
      or jsonb_typeof(d.state#>'{bank,adjustments}') is distinct from 'array'
    )
  ) then
    raise exception 'postflight_invalid_kupa_live_shape';
  end if;

  if exists (
    select 1 from public.order_management_documents d
    where d.document_name='suppliers' and (
      d.state ? 'checks'
      or jsonb_typeof(d.state) is distinct from 'object'
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
    raise exception 'postflight_invalid_orders_live_shape';
  end if;

  if exists (
    select 1 from public.shared_checks_documents d
    where d.document_name='main' and (
      jsonb_typeof(d.state) is distinct from 'object'
      or d.state->>'version' is distinct from '1'
      or jsonb_typeof(d.state->'checks') is distinct from 'array'
      or jsonb_typeof(d.state->'bankEvents') is distinct from 'array'
    )
  ) then
    raise exception 'postflight_invalid_shared_checks_live_shape';
  end if;

  -- תקינות רשומות הצ'קים וזהויות.
  if exists (
    select 1
    from public.shared_checks_documents s
    cross join lateral jsonb_array_elements(s.state->'checks') c
    where s.document_name='main' and (
      jsonb_typeof(c) is distinct from 'object'
      or nullif(btrim(c->>'id'),'') is null
      or jsonb_typeof(c->'amount') is distinct from 'number'
      or jsonb_typeof(c->'dueDate') is distinct from 'string'
      or jsonb_typeof(c->'status') is distinct from 'string'
      or c->>'status' not in ('בקופה','הופקד - במעקב','נפרע','חזר','בוטל')
    )
  ) then
    raise exception 'postflight_invalid_shared_check_record';
  end if;
  if exists (
    select 1
    from public.shared_checks_documents s
    cross join lateral jsonb_array_elements(s.state->'checks') c
    where s.document_name='main'
    group by s.owner_id,c->>'id'
    having count(*)>1
  ) then
    raise exception 'postflight_duplicate_shared_check_id';
  end if;

  -- מיד לאחר cutover אין עדיין אירועי delta חדשים; כל ההפקדות ההיסטוריות כלולות ב-baseline החדש.
  if exists (
    select 1 from public.shared_checks_documents s
    where s.document_name='main' and jsonb_array_length(s.state->'bankEvents')<>0
  ) then
    raise exception 'postflight_bank_events_not_empty_before_reopen';
  end if;

  -- צילום הבנק של cutover חייב להיות baseline שרתי תקין וללא התאמות check_deposit ישנות.
  if exists (
    select 1 from public.kupa_documents k
    where k.document_name='main' and (
      jsonb_typeof(k.state#>'{bank,currentBalance}') is distinct from 'number'
      or jsonb_typeof(k.state#>'{bank,snapshotSeq}') is distinct from 'number'
      or (k.state#>>'{bank,snapshotSeq}')::numeric <= 0
      or (k.state#>>'{bank,snapshotSeq}')::numeric <> trunc((k.state#>>'{bank,snapshotSeq}')::numeric)
      or nullif(k.state#>>'{bank,snapshotToken}','') is null
      or nullif(k.state#>>'{bank,updatedAt}','') is null
      or exists (
        select 1 from jsonb_array_elements(k.state#>'{bank,adjustments}') a
        where a->>'type'='check_deposit'
      )
    )
  ) then
    raise exception 'postflight_invalid_bank_baseline';
  end if;

  -- ה-shared checks חייב להיות העתק קנוני של snapshot המקור שקדם ל-cutover.
  if exists (
    with old_kupa as (
      select distinct on (b.owner_id)
        b.owner_id,b.revision,b.state
      from public.kupa_document_backups b
      where b.document_name='main' and b.state ? 'checks'
      order by b.owner_id,b.revision desc,b.id desc
    ), canonical as (
      select b.owner_id,b.revision,
             coalesce((
               select jsonb_agg(
                 (c.value - 'bankEvents' - 'depositSeq' - 'depositedAt')
                 || jsonb_build_object('depositSeq',null,'depositedAt',null)
                 order by c.ord
               )
               from jsonb_array_elements(b.state->'checks') with ordinality c(value,ord)
             ),'[]'::jsonb) checks
      from old_kupa b
    )
    select 1
    from canonical c
    join public.kupa_documents k on k.owner_id=c.owner_id and k.document_name='main'
    join public.shared_checks_documents s on s.owner_id=c.owner_id and s.document_name='main'
    where c.revision<>k.revision-1
       or c.checks is distinct from s.state->'checks'
  ) then
    raise exception 'postflight_kupa_backup_or_shared_checks_mismatch';
  end if;

  if exists (
    with old_orders as (
      select distinct on (b.owner_id)
        b.owner_id,b.revision,b.state
      from public.order_management_document_backups b
      where b.document_name='suppliers' and b.state ? 'checks'
      order by b.owner_id,b.revision desc,b.id desc
    ), canonical as (
      select b.owner_id,b.revision,
             coalesce((
               select jsonb_agg(
                 (c.value - 'bankEvents' - 'depositSeq' - 'depositedAt')
                 || jsonb_build_object('depositSeq',null,'depositedAt',null)
                 order by c.ord
               )
               from jsonb_array_elements(b.state->'checks') with ordinality c(value,ord)
             ),'[]'::jsonb) checks
      from old_orders b
    )
    select 1
    from canonical c
    join public.order_management_documents o on o.owner_id=c.owner_id and o.document_name='suppliers'
    join public.shared_checks_documents s on s.owner_id=c.owner_id and s.document_name='main'
    where c.revision<>o.revision-1
       or c.checks is distinct from s.state->'checks'
  ) then
    raise exception 'postflight_orders_backup_or_shared_checks_mismatch';
  end if;

  -- מוודאים שבאמת נמצא snapshot ישן לכל מסמך ולא עברנו ללא נקודת שחזור.
  if exists (
    select 1 from public.kupa_documents k
    where k.document_name='main' and not exists (
      select 1 from public.kupa_document_backups b
      where b.owner_id=k.owner_id and b.document_name='main' and b.revision=k.revision-1 and b.state ? 'checks'
    )
  ) then
    raise exception 'postflight_missing_pre_cutover_kupa_backup';
  end if;
  if exists (
    select 1 from public.order_management_documents o
    where o.document_name='suppliers' and not exists (
      select 1 from public.order_management_document_backups b
      where b.owner_id=o.owner_id and b.document_name='suppliers' and b.revision=o.revision-1 and b.state ? 'checks'
    )
  ) then
    raise exception 'postflight_missing_pre_cutover_orders_backup';
  end if;

  -- RLS חייב להיות פעיל בכל טבלאות הנתונים והגיבויים.
  if exists (
    select 1
    from (values
      ('kupa_documents'),('kupa_document_backups'),('kupa_periodic_backups'),
      ('order_management_documents'),('order_management_document_backups'),('order_management_periodic_backups'),
      ('shared_checks_documents'),('shared_checks_document_backups'),('shared_checks_periodic_backups')
    ) x(name)
    left join pg_class c on c.relname=x.name and c.relnamespace='public'::regnamespace
    where c.oid is null or not c.relrowsecurity
  ) then
    raise exception 'postflight_rls_not_enabled';
  end if;

  -- פונקציות write חייבות להישאר SECURITY INVOKER; anon אינו רשאי להפעיל אותן.
  if exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('save_kupa_document','save_order_management_document','save_shared_checks_document')
      and p.prosecdef
  ) then
    raise exception 'postflight_security_definer_write_rpc_forbidden';
  end if;
  if has_function_privilege('anon','public.save_kupa_document(text,bigint,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.save_order_management_document(text,bigint,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.save_shared_checks_document(text,bigint,jsonb)','EXECUTE') then
    raise exception 'postflight_anon_execute_grant_detected';
  end if;
  if not has_function_privilege('authenticated','public.save_kupa_document(text,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.save_order_management_document(text,bigint,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.save_shared_checks_document(text,bigint,jsonb)','EXECUTE') then
    raise exception 'postflight_authenticated_execute_grant_missing';
  end if;

  -- write guards חייבים להיות מותקנים על שלושת המסמכים החיים.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where not t.tgisinternal and c.relnamespace='public'::regnamespace
      and c.relname='kupa_documents' and t.tgname='kupa_documents_write_guard'
  ) or not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where not t.tgisinternal and c.relnamespace='public'::regnamespace
      and c.relname='order_management_documents' and t.tgname='order_management_documents_write_guard'
  ) or not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where not t.tgisinternal and c.relnamespace='public'::regnamespace
      and c.relname='shared_checks_documents' and t.tgname='shared_checks_documents_write_guard'
  ) then
    raise exception 'postflight_write_guard_missing';
  end if;

  -- כל constraints שהותקנו חייבים להיות VALIDATED.
  if exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    where c.relnamespace='public'::regnamespace
      and c.relname in (
        'kupa_documents','kupa_document_backups','kupa_periodic_backups',
        'order_management_documents','order_management_document_backups','order_management_periodic_backups',
        'shared_checks_documents','shared_checks_document_backups','shared_checks_periodic_backups'
      )
      and not con.convalidated
  ) then
    raise exception 'postflight_unvalidated_constraint';
  end if;

  select last_value into v_seq_last from public.shared_financial_event_seq;
  if exists (
    select 1 from public.kupa_documents k
    where k.document_name='main' and (k.state#>>'{bank,snapshotSeq}')::bigint > v_seq_last
  ) then
    raise exception 'postflight_snapshot_sequence_ahead_of_sequence';
  end if;
end
$postflight$;

-- פלט מסכם לשמירה יחד עם צילום ה-preflight.
with old_kupa as (
  select distinct on (b.owner_id) b.owner_id,b.revision
  from public.kupa_document_backups b
  where b.document_name='main' and b.state ? 'checks'
  order by b.owner_id,b.revision desc,b.id desc
), old_orders as (
  select distinct on (b.owner_id) b.owner_id,b.revision
  from public.order_management_document_backups b
  where b.document_name='suppliers' and b.state ? 'checks'
  order by b.owner_id,b.revision desc,b.id desc
)
select
  s.owner_id,
  k.revision as kupa_revision_after,
  ok.revision as kupa_revision_before,
  o.revision as orders_revision_after,
  oo.revision as orders_revision_before,
  s.revision as shared_checks_revision,
  jsonb_array_length(s.state->'checks') as checks_count,
  md5((s.state->'checks')::text) as shared_checks_hash,
  jsonb_array_length(s.state->'bankEvents') as bank_events_count,
  k.state#>>'{bank,snapshotSeq}' as bank_snapshot_seq,
  k.state#>>'{bank,asOfDate}' as bank_as_of_date,
  k.state#>>'{bank,updatedAt}' as bank_snapshot_at,
  k.updated_at as kupa_cutover_at,
  o.updated_at as orders_cutover_at,
  s.updated_at as shared_checks_created_at
from public.shared_checks_documents s
join public.kupa_documents k on k.owner_id=s.owner_id and k.document_name='main'
join public.order_management_documents o on o.owner_id=s.owner_id and o.document_name='suppliers'
left join old_kupa ok on ok.owner_id=s.owner_id
left join old_orders oo on oo.owner_id=s.owner_id
where s.document_name='main'
order by s.owner_id;
