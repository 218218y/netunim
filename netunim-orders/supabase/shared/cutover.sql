-- PRODUCTION CUTOVER — צ'קים למקור אמת משותף
-- חובה לפני הרצה:
-- 1) כל העובדים הפסיקו עבודה בשתי המערכות.
-- 2) בקופה נשמר צילום יתרת עו"ש חדש.
-- 3) preflight.sql עבר ללא שגיאה.
-- 4) שתי גרסאות האתר החדשות מוכנות להעלאה מיד אחרי COMMIT.
--
-- כל המעבר טרנזקציוני. כשל בכל שלב = ROLLBACK מלא.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '180s';

-- חסימה פיזית של כתיבות מתחרות בזמן ה-cutover. אם יש עובד שעדיין כותב,
-- lock_timeout מפיל את העסקה במקום להסתכן ב-race.
lock table public.kupa_documents in share row exclusive mode;
lock table public.order_management_documents in share row exclusive mode;

-- assertions זהים ל-preflight, שוב בתוך אותה עסקה ולאחר הנעילה.
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

-- שכבת הצ'קים המשותפת + RLS/RPC/גיבויים.
set local lock_timeout = '10s';
set local statement_timeout = '90s';

-- סדר פיננסי מונוטוני משותף לצילום יתרת בנק ולהפקדת צ'ק.
-- השרת בלבד מקצה מספרים; אין להסתמך על שעוני מחשבי הקצה לסדר אירועים כספיים.
create sequence if not exists public.shared_financial_event_seq as bigint;
revoke all on sequence public.shared_financial_event_seq from public, anon, authenticated;
grant usage on sequence public.shared_financial_event_seq to authenticated;

create table if not exists public.shared_checks_documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null default 'main',
  revision bigint not null default 1 check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, document_name)
);

create table if not exists public.shared_checks_document_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null check (revision > 0),
  state jsonb not null,
  saved_at timestamptz not null default now()
);

create table if not exists public.shared_checks_periodic_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null check (revision > 0),
  state jsonb not null,
  saved_at timestamptz not null default now()
);

create index if not exists shared_checks_backups_owner_doc_saved_idx
  on public.shared_checks_document_backups(owner_id, document_name, saved_at desc);
create index if not exists shared_checks_periodic_owner_doc_saved_idx
  on public.shared_checks_periodic_backups(owner_id, document_name, saved_at desc);
create unique index if not exists shared_checks_backups_owner_doc_revision_uidx
  on public.shared_checks_document_backups(owner_id, document_name, revision);
create unique index if not exists shared_checks_periodic_owner_doc_revision_uidx
  on public.shared_checks_periodic_backups(owner_id, document_name, revision);

-- מסמך חי: אובייקט עם מערך checks בלבד כדומיין העסקי המרכזי.
-- היסטוריית גיבוי מקבלת אותו חוזה מבני.
alter table public.shared_checks_documents drop constraint if exists shared_checks_documents_state_shape_check;
alter table public.shared_checks_documents
  add constraint shared_checks_documents_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and jsonb_typeof(state->'checks') = 'array'
    and jsonb_typeof(state->'bankEvents') = 'array'
  ) not valid;

alter table public.shared_checks_document_backups drop constraint if exists shared_checks_document_backups_state_shape_check;
alter table public.shared_checks_document_backups
  add constraint shared_checks_document_backups_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and jsonb_typeof(state->'checks') = 'array'
    and jsonb_typeof(state->'bankEvents') = 'array'
  ) not valid;

alter table public.shared_checks_periodic_backups drop constraint if exists shared_checks_periodic_backups_state_shape_check;
alter table public.shared_checks_periodic_backups
  add constraint shared_checks_periodic_backups_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and jsonb_typeof(state->'checks') = 'array'
    and jsonb_typeof(state->'bankEvents') = 'array'
  ) not valid;

alter table public.shared_checks_documents validate constraint shared_checks_documents_state_shape_check;
alter table public.shared_checks_document_backups validate constraint shared_checks_document_backups_state_shape_check;
alter table public.shared_checks_periodic_backups validate constraint shared_checks_periodic_backups_state_shape_check;

alter table public.shared_checks_documents enable row level security;
alter table public.shared_checks_document_backups enable row level security;
alter table public.shared_checks_periodic_backups enable row level security;

revoke all on table public.shared_checks_documents from anon, authenticated;
revoke all on table public.shared_checks_document_backups from anon, authenticated;
revoke all on table public.shared_checks_periodic_backups from anon, authenticated;
grant select, insert, update on table public.shared_checks_documents to authenticated;
grant select, insert, delete on table public.shared_checks_document_backups to authenticated;
grant select, insert, delete on table public.shared_checks_periodic_backups to authenticated;

revoke all on sequence public.shared_checks_document_backups_id_seq from public, anon;
revoke all on sequence public.shared_checks_periodic_backups_id_seq from public, anon;
grant usage, select on sequence public.shared_checks_document_backups_id_seq to authenticated;
grant usage, select on sequence public.shared_checks_periodic_backups_id_seq to authenticated;

drop policy if exists "shared_checks_documents_select_own" on public.shared_checks_documents;
create policy "shared_checks_documents_select_own" on public.shared_checks_documents
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_documents_insert_own" on public.shared_checks_documents;
create policy "shared_checks_documents_insert_own" on public.shared_checks_documents
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_documents_update_own" on public.shared_checks_documents;
create policy "shared_checks_documents_update_own" on public.shared_checks_documents
for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_backups_select_own" on public.shared_checks_document_backups;
create policy "shared_checks_backups_select_own" on public.shared_checks_document_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_backups_insert_own" on public.shared_checks_document_backups;
create policy "shared_checks_backups_insert_own" on public.shared_checks_document_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_backups_delete_own" on public.shared_checks_document_backups;
create policy "shared_checks_backups_delete_own" on public.shared_checks_document_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_periodic_select_own" on public.shared_checks_periodic_backups;
create policy "shared_checks_periodic_select_own" on public.shared_checks_periodic_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_periodic_insert_own" on public.shared_checks_periodic_backups;
create policy "shared_checks_periodic_insert_own" on public.shared_checks_periodic_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "shared_checks_periodic_delete_own" on public.shared_checks_periodic_backups;
create policy "shared_checks_periodic_delete_own" on public.shared_checks_periodic_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

create or replace function public.shared_checks_guard_document_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user = 'authenticated'
     and coalesce(current_setting('app.shared_checks_rpc_write', true), '') <> '1' then
    raise exception 'direct_shared_checks_write_forbidden'
      using errcode = '42501',
            hint = 'Use save_shared_checks_document RPC so revision checks and backups cannot be bypassed.';
  end if;
  if tg_op = 'UPDATE' and (
       new.owner_id is distinct from old.owner_id
       or new.document_name is distinct from old.document_name
     ) then
    raise exception 'shared_checks_identity_change_forbidden' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.shared_checks_guard_document_write() from public, anon;
grant execute on function public.shared_checks_guard_document_write() to authenticated;

drop trigger if exists shared_checks_documents_write_guard on public.shared_checks_documents;
create trigger shared_checks_documents_write_guard
before insert or update on public.shared_checks_documents
for each row execute function public.shared_checks_guard_document_write();

-- מחליפים במפורש כדי שניתן יהיה להוסיף state לפלט גם אם הייתה גרסה קודמת.
drop function if exists public.save_shared_checks_document(text, bigint, jsonb);
create function public.save_shared_checks_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz, state jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_current_revision bigint;
  v_old_state jsonb;
  v_old_updated_at timestamptz;
  v_server_state jsonb;
  v_server_checks jsonb := '[]'::jsonb;
  v_bank_events jsonb := '[]'::jsonb;
  v_check jsonb;
  v_old_check jsonb;
  v_check_id text;
  v_status text;
  v_old_status text;
  v_is_deposited boolean;
  v_was_deposited boolean;
  v_old_effect numeric;
  v_new_effect numeric;
  v_effect_delta numeric;
  v_event_seq bigint;
  v_now timestamptz;
  v_new_revision bigint;
  v_new_updated_at timestamptz;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Shared per-user financial writer gate: fail fast instead of filling the PostgREST pool.
  if not pg_try_advisory_xact_lock(
    hashtextextended('netunim_financial_write:' || v_owner::text, 0)
  ) then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout', '100ms', true);
  if p_document_name is null or btrim(p_document_name) = '' then
    raise exception 'invalid_document_name' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_expected_revision' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or jsonb_typeof(p_state->'checks') is distinct from 'array' then
    raise exception 'invalid_shared_checks_state'
      using errcode = '22023', hint = 'State must be an object containing a checks array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_state->'checks') c
    where jsonb_typeof(c) is distinct from 'object'
       or nullif(btrim(c->>'id'), '') is null
       or jsonb_typeof(c->'amount') is distinct from 'number'
       or jsonb_typeof(c->'dueDate') is distinct from 'string'
       or jsonb_typeof(c->'status') is distinct from 'string'
       or (c->>'status') not in ('בקופה','הופקד - במעקב','נפרע','חזר','בוטל')
  ) then
    raise exception 'invalid_shared_check_record' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_state->'checks') c
    group by c->>'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_shared_check_id' using errcode = '23505';
  end if;

  perform set_config('app.shared_checks_rpc_write', '1', true);

  select d.revision, d.state, d.updated_at
    into v_current_revision, v_old_state, v_old_updated_at
  from public.shared_checks_documents d
  where d.owner_id = v_owner and d.document_name = p_document_name
  for update;

  if v_old_state is not null and jsonb_typeof(v_old_state->'bankEvents') = 'array' then
    v_bank_events := v_old_state->'bankEvents';
  end if;

  -- Fail closed against a stale/bootstrap client interpreting an empty local shell as "delete every check".
  -- Normal single-record deletion remains available, including deletion of the final remaining check.
  if v_old_state is not null
     and jsonb_typeof(v_old_state->'checks') = 'array'
     and jsonb_array_length(v_old_state->'checks') > 1
     and jsonb_array_length(p_state->'checks') = 0 then
    raise exception 'bulk_delete_all_shared_checks_forbidden'
      using errcode = '22023', hint = 'Refresh from shared_checks_documents before attempting a bulk deletion.';
  end if;

  -- הלקוח שולח את מצב הצ'קים בלבד. depositSeq/depositedAt ו-bankEvents הם server-authoritative.
  -- כל שינוי בהשפעה הכספית של צ'ק יוצר אירוע delta מונוטוני, כולל החזרה, שינוי סכום ומחיקה.
  for v_check in select value from jsonb_array_elements(p_state->'checks') loop
    v_check_id := v_check->>'id';
    v_status := v_check->>'status';
    v_is_deposited := v_status in ('הופקד - במעקב','נפרע');
    v_old_check := null;
    if v_old_state is not null then
      select c.value into v_old_check
      from jsonb_array_elements(v_old_state->'checks') c(value)
      where c.value->>'id' = v_check_id
      limit 1;
    end if;
    v_old_status := coalesce(v_old_check->>'status','');
    v_was_deposited := v_old_status in ('הופקד - במעקב','נפרע');
    v_old_effect := case when v_was_deposited then coalesce((v_old_check->>'amount')::numeric,0) else 0 end;
    v_new_effect := case when v_is_deposited then coalesce((v_check->>'amount')::numeric,0) else 0 end;
    v_effect_delta := v_new_effect - v_old_effect;
    v_event_seq := null;
    v_now := null;

    -- כל metadata שהלקוח החזיר מנוקה ומוחזר מהמצב השרת/מהאירוע החדש בלבד.
    v_check := v_check - 'depositSeq' - 'depositedAt' - 'bankEvents';

    if v_is_deposited and not v_was_deposited then
      v_event_seq := nextval('public.shared_financial_event_seq');
      v_now := clock_timestamp();
      v_check := v_check || jsonb_build_object('depositSeq', v_event_seq, 'depositedAt', v_now);
    elsif v_old_check is not null then
      -- retry אחרי ACK שאבד מקבל שוב בדיוק את metadata שכבר אושר בשרת.
      v_check := v_check || jsonb_build_object(
        'depositSeq', coalesce(v_old_check->'depositSeq','null'::jsonb),
        'depositedAt', coalesce(v_old_check->'depositedAt','null'::jsonb)
      );
    else
      v_check := v_check || jsonb_build_object('depositSeq', null, 'depositedAt', null);
    end if;

    if v_effect_delta <> 0 then
      if v_event_seq is null then
        v_event_seq := nextval('public.shared_financial_event_seq');
        v_now := clock_timestamp();
      end if;
      v_bank_events := v_bank_events || jsonb_build_array(jsonb_build_object(
        'seq', v_event_seq,
        'at', v_now,
        'delta', v_effect_delta,
        'kind', 'check_effect_delta',
        'checkId', v_check_id
      ));
    end if;

    v_server_checks := v_server_checks || jsonb_build_array(v_check);
  end loop;

  -- מחיקת צ'ק בעל השפעה בנקאית חייבת ליצור reversal גם לאחר שהרשומה עצמה נעלמה.
  if v_old_state is not null then
    for v_old_check in
      select c.value
      from jsonb_array_elements(v_old_state->'checks') c(value)
      where not exists (
        select 1 from jsonb_array_elements(p_state->'checks') n(value)
        where n.value->>'id' = c.value->>'id'
      )
    loop
      v_old_status := coalesce(v_old_check->>'status','');
      if v_old_status in ('הופקד - במעקב','נפרע') then
        v_old_effect := coalesce((v_old_check->>'amount')::numeric,0);
        if v_old_effect <> 0 then
          v_event_seq := nextval('public.shared_financial_event_seq');
          v_now := clock_timestamp();
          v_bank_events := v_bank_events || jsonb_build_array(jsonb_build_object(
            'seq', v_event_seq,
            'at', v_now,
            'delta', -v_old_effect,
            'kind', 'check_effect_delta',
            'checkId', v_old_check->>'id'
          ));
        end if;
      end if;
    end loop;
  end if;

  v_server_state := jsonb_build_object('version',1,'checks',v_server_checks,'bankEvents',v_bank_events);

  if v_current_revision is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    insert into public.shared_checks_documents(owner_id, document_name, revision, state, updated_at)
    values (v_owner, p_document_name, 1, v_server_state, now())
    returning shared_checks_documents.revision, shared_checks_documents.updated_at, shared_checks_documents.state
      into v_new_revision, v_new_updated_at, v_server_state;
    insert into public.shared_checks_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
    return query select v_new_revision, v_new_updated_at, v_server_state;
    return;
  end if;

  -- Idempotency לפני conflict: lost ACK עם expected revision ישן אינו יוצר כשל שווא.
  if v_old_state = v_server_state then
    return query select v_current_revision, v_old_updated_at, v_old_state;
    return;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  insert into public.shared_checks_document_backups(owner_id, document_name, revision, state, saved_at)
  values (v_owner, p_document_name, v_current_revision, v_old_state, v_old_updated_at)
  on conflict do nothing;

  update public.shared_checks_documents d
  set revision = d.revision + 1, state = v_server_state, updated_at = now()
  where d.owner_id = v_owner and d.document_name = p_document_name
  returning d.revision, d.updated_at, d.state
    into v_new_revision, v_new_updated_at, v_server_state;

  if not exists (
    select 1 from public.shared_checks_periodic_backups p
    where p.owner_id = v_owner and p.document_name = p_document_name
      and p.saved_at > now() - interval '12 hours'
  ) then
    insert into public.shared_checks_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
  end if;

  delete from public.shared_checks_periodic_backups p
  where p.owner_id = v_owner and p.document_name = p_document_name
    and p.saved_at < now() - interval '365 days';

  delete from public.shared_checks_document_backups b
  where b.owner_id = v_owner and b.document_name = p_document_name
    and b.id in (
      select x.id from public.shared_checks_document_backups x
      where x.owner_id = v_owner and x.document_name = p_document_name
      order by x.saved_at desc, x.id desc offset 200
    );

  return query select v_new_revision, v_new_updated_at, v_server_state;
end;
$$;
revoke all on function public.save_shared_checks_document(text, bigint, jsonb) from public, anon;
grant execute on function public.save_shared_checks_document(text, bigint, jsonb) to authenticated;

-- הגנת ה-state הישנה של קופה חייבה checks; מסירים אותה רק בתוך העסקה,
-- רגע לפני שינוי ה-state. אם ההמשך נכשל גם ההסרה מתגלגלת לאחור.
alter table public.kupa_documents drop constraint if exists kupa_documents_state_shape_check;

-- ה-ON CONFLICT של snapshots חייב להיות מגובה באינדקס ייחודי כבר לפני הכתיבה הראשונה.
-- preflight וידא שאין כפילויות היסטוריות; אם מצב אחר השתנה מאז, יצירת האינדקס תכשיל
-- את כל העסקה לפני שינוי ה-live documents.
create unique index if not exists kupa_document_backups_owner_doc_revision_uidx
  on public.kupa_document_backups(owner_id, document_name, revision);
create unique index if not exists kupa_periodic_backups_owner_doc_revision_uidx
  on public.kupa_periodic_backups(owner_id, document_name, revision);
create unique index if not exists order_management_backups_owner_doc_revision_uidx
  on public.order_management_document_backups(owner_id, document_name, revision);
create unique index if not exists order_management_periodic_backups_owner_doc_revision_uidx
  on public.order_management_periodic_backups(owner_id, document_name, revision);

-- Snapshot בלתי-תלוי של שני המקורות לפני שינוי ה-live documents.
insert into public.kupa_document_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.kupa_documents where document_name='main'
on conflict (owner_id,document_name,revision) do nothing;
insert into public.kupa_periodic_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.kupa_documents where document_name='main'
on conflict (owner_id,document_name,revision) do nothing;

insert into public.order_management_document_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.order_management_documents where document_name='suppliers'
on conflict (owner_id,document_name,revision) do nothing;
insert into public.order_management_periodic_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.order_management_documents where document_name='suppliers'
on conflict (owner_id,document_name,revision) do nothing;

-- יצירת מקור האמת של הצ'קים מתוך העותק שאומת כ-identical בשני המקורות.
-- depositSeq מאופס בכוונה: צילום הבנק החדש הוא baseline וכל ההפקדות הישנות
-- כבר כלולות ביתרה שצולמה לפני freeze.
insert into public.shared_checks_documents(owner_id,document_name,revision,state,updated_at)
select
  k.owner_id,
  'main',
  1,
  jsonb_build_object(
    'version',1,
    'checks',coalesce((
      select jsonb_agg((c.value - 'bankEvents' - 'depositSeq' - 'depositedAt') || jsonb_build_object('depositSeq',null,'depositedAt',null) order by c.ord)
      from jsonb_array_elements(k.state->'checks') with ordinality as c(value,ord)
    ),'[]'::jsonb),
    'bankEvents','[]'::jsonb
  ),
  clock_timestamp()
from public.kupa_documents k
where k.document_name='main'
  and not exists (
    select 1 from public.shared_checks_documents s
    where s.owner_id=k.owner_id and s.document_name='main'
  );

-- אם מסמך shared כבר היה קיים וה-preflight קבע שהוא זהה, משאירים אותו.
-- initial periodic snapshot לכל מסמך shared שקיים כעת.
insert into public.shared_checks_periodic_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.shared_checks_documents where document_name='main'
on conflict (owner_id,document_name,revision) do nothing;

-- צילום הבנק מקבל sequence שרתי אחרי כל ההפקדות ההיסטוריות; זה baseline.
with bank_cutover as (
  select owner_id, nextval('public.shared_financial_event_seq') as snapshot_seq, clock_timestamp() as server_now
  from public.kupa_documents where document_name='main'
)
update public.kupa_documents k
set state = (k.state - 'checks' - 'bank') || jsonb_build_object(
      'bank', (k.state->'bank') || jsonb_build_object(
        'snapshotToken','cutover-' || md5(k.owner_id::text || ':' || b.snapshot_seq::text || ':' || b.server_now::text),
        'snapshotSeq',b.snapshot_seq,
        'updatedAt',b.server_now
      )
    ),
    revision = k.revision + 1,
    updated_at = b.server_now
from bank_cutover b
where k.owner_id=b.owner_id and k.document_name='main';

-- מסמך ההזמנות מפסיק לשמור עותק פעיל של checks.
update public.order_management_documents o
set state = o.state - 'checks',
    revision = o.revision + 1,
    updated_at = clock_timestamp()
where o.document_name='suppliers';

-- Snapshot מיידי גם של המצב החדש כדי להקל rollback/forensics.
insert into public.kupa_periodic_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.kupa_documents where document_name='main'
on conflict (owner_id,document_name,revision) do nothing;
insert into public.order_management_periodic_backups(owner_id,document_name,revision,state,saved_at)
select owner_id,document_name,revision,state,updated_at
from public.order_management_documents where document_name='suppliers'
on conflict (owner_id,document_name,revision) do nothing;

-- כעת, ורק לאחר שה-state הומר, מתקינים את החוזים הסופיים של הקופה וההזמנות.
set local lock_timeout = '10s';
set local statement_timeout = '90s';

-- אותו sequence משמש את RPC הקופה (צילום יתרה) ואת RPC הצ'קים (הפקדה).
create sequence if not exists public.shared_financial_event_seq as bigint;
revoke all on sequence public.shared_financial_event_seq from public, anon, authenticated;
grant usage on sequence public.shared_financial_event_seq to authenticated;

create table if not exists public.kupa_documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null default 'main',
  revision bigint not null default 1 check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, document_name)
);
create table if not exists public.kupa_document_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  saved_at timestamptz not null default now()
);
create table if not exists public.kupa_periodic_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  saved_at timestamptz not null default now()
);

create index if not exists kupa_document_backups_owner_doc_saved_idx
  on public.kupa_document_backups(owner_id, document_name, saved_at desc);
create index if not exists kupa_periodic_backups_owner_doc_saved_idx
  on public.kupa_periodic_backups(owner_id, document_name, saved_at desc);
create unique index if not exists kupa_document_backups_owner_doc_revision_uidx
  on public.kupa_document_backups(owner_id, document_name, revision);
create unique index if not exists kupa_periodic_backups_owner_doc_revision_uidx
  on public.kupa_periodic_backups(owner_id, document_name, revision);

-- מסמך חי: checks אסור במפורש. bank.adjustments אינו רשאי להכיל check_deposit.
alter table public.kupa_documents drop constraint if exists kupa_documents_state_shape_check;
alter table public.kupa_documents
  add constraint kupa_documents_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and not (state ? 'checks')
    and jsonb_typeof(state->'credits') = 'array'
    and jsonb_typeof(state->'cash') = 'array'
    and jsonb_typeof(state->'expenses') = 'array'
    and jsonb_typeof(state->'cards') = 'array'
    and jsonb_typeof(state->'bank') = 'object'
    and jsonb_typeof(state#>'{bank,adjustments}') = 'array'
  ) not valid;

-- גיבויים חייבים להמשיך לקבל גם snapshots היסטוריים מלפני ה-cutover שבהם checks היה קיים.
alter table public.kupa_document_backups drop constraint if exists kupa_document_backups_revision_check;
alter table public.kupa_document_backups
  add constraint kupa_document_backups_revision_check check (revision > 0) not valid;
alter table public.kupa_document_backups drop constraint if exists kupa_document_backups_state_shape_check;
alter table public.kupa_document_backups
  add constraint kupa_document_backups_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and (not (state ? 'checks') or jsonb_typeof(state->'checks') = 'array')
    and jsonb_typeof(state->'credits') = 'array'
    and jsonb_typeof(state->'cash') = 'array'
    and jsonb_typeof(state->'expenses') = 'array'
    and jsonb_typeof(state->'cards') = 'array'
  ) not valid;
alter table public.kupa_periodic_backups drop constraint if exists kupa_periodic_backups_revision_check;
alter table public.kupa_periodic_backups
  add constraint kupa_periodic_backups_revision_check check (revision > 0) not valid;
alter table public.kupa_periodic_backups drop constraint if exists kupa_periodic_backups_state_shape_check;
alter table public.kupa_periodic_backups
  add constraint kupa_periodic_backups_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and (not (state ? 'checks') or jsonb_typeof(state->'checks') = 'array')
    and jsonb_typeof(state->'credits') = 'array'
    and jsonb_typeof(state->'cash') = 'array'
    and jsonb_typeof(state->'expenses') = 'array'
    and jsonb_typeof(state->'cards') = 'array'
  ) not valid;

alter table public.kupa_documents validate constraint kupa_documents_state_shape_check;
alter table public.kupa_document_backups validate constraint kupa_document_backups_revision_check;
alter table public.kupa_document_backups validate constraint kupa_document_backups_state_shape_check;
alter table public.kupa_periodic_backups validate constraint kupa_periodic_backups_revision_check;
alter table public.kupa_periodic_backups validate constraint kupa_periodic_backups_state_shape_check;

alter table public.kupa_documents enable row level security;
alter table public.kupa_document_backups enable row level security;
alter table public.kupa_periodic_backups enable row level security;
revoke all on table public.kupa_documents from anon, authenticated;
revoke all on table public.kupa_document_backups from anon, authenticated;
revoke all on table public.kupa_periodic_backups from anon, authenticated;
grant select, insert, update on table public.kupa_documents to authenticated;
grant select, insert, delete on table public.kupa_document_backups to authenticated;
grant select, insert, delete on table public.kupa_periodic_backups to authenticated;
revoke all on sequence public.kupa_document_backups_id_seq from public, anon;
revoke all on sequence public.kupa_periodic_backups_id_seq from public, anon;
grant usage, select on sequence public.kupa_document_backups_id_seq to authenticated;
grant usage, select on sequence public.kupa_periodic_backups_id_seq to authenticated;

drop policy if exists "kupa_documents_select_own" on public.kupa_documents;
create policy "kupa_documents_select_own" on public.kupa_documents
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_documents_insert_own" on public.kupa_documents;
create policy "kupa_documents_insert_own" on public.kupa_documents
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_documents_update_own" on public.kupa_documents;
create policy "kupa_documents_update_own" on public.kupa_documents
for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "kupa_backups_select_own" on public.kupa_document_backups;
create policy "kupa_backups_select_own" on public.kupa_document_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_backups_insert_own" on public.kupa_document_backups;
create policy "kupa_backups_insert_own" on public.kupa_document_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_backups_delete_own" on public.kupa_document_backups;
create policy "kupa_backups_delete_own" on public.kupa_document_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "kupa_periodic_backups_select_own" on public.kupa_periodic_backups;
create policy "kupa_periodic_backups_select_own" on public.kupa_periodic_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_periodic_backups_insert_own" on public.kupa_periodic_backups;
create policy "kupa_periodic_backups_insert_own" on public.kupa_periodic_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "kupa_periodic_backups_delete_own" on public.kupa_periodic_backups;
create policy "kupa_periodic_backups_delete_own" on public.kupa_periodic_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

create or replace function public.kupa_guard_document_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user = 'authenticated'
     and coalesce(current_setting('app.kupa_rpc_write', true), '') <> '1' then
    raise exception 'direct_kupa_write_forbidden'
      using errcode = '42501',
            hint = 'Use save_kupa_document RPC so revision checks and backups cannot be bypassed.';
  end if;
  if tg_op = 'UPDATE' and (
       new.owner_id is distinct from old.owner_id
       or new.document_name is distinct from old.document_name
     ) then
    raise exception 'kupa_document_identity_change_forbidden' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.kupa_guard_document_write() from public, anon;
grant execute on function public.kupa_guard_document_write() to authenticated;
drop trigger if exists kupa_documents_write_guard on public.kupa_documents;
create trigger kupa_documents_write_guard
before insert or update on public.kupa_documents
for each row execute function public.kupa_guard_document_write();

-- הפלט כולל את state שהשרת אישר, משום snapshotSeq/updatedAt של צילום בנק הם server-authoritative.
drop function if exists public.save_kupa_document(text, bigint, jsonb);
create function public.save_kupa_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz, state jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_current_revision bigint;
  v_old_state jsonb;
  v_old_updated_at timestamptz;
  v_server_state jsonb;
  v_bank jsonb;
  v_old_bank jsonb;
  v_new_token text;
  v_old_token text;
  v_requested_snapshot_num numeric;
  v_requested_snapshot_seq bigint;
  v_old_snapshot_seq bigint := 0;
  v_shared_max_seq bigint := 0;
  v_now timestamptz;
  v_new_revision bigint;
  v_new_updated_at timestamptz;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Shared per-user financial writer gate: fail fast instead of filling the PostgREST pool.
  if not pg_try_advisory_xact_lock(
    hashtextextended('netunim_financial_write:' || v_owner::text, 0)
  ) then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout', '100ms', true);
  if p_document_name is null or btrim(p_document_name) = '' then
    raise exception 'invalid_document_name' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_expected_revision' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or (p_state ? 'checks')
     or jsonb_typeof(p_state->'credits') is distinct from 'array'
     or jsonb_typeof(p_state->'cash') is distinct from 'array'
     or jsonb_typeof(p_state->'expenses') is distinct from 'array'
     or jsonb_typeof(p_state->'cards') is distinct from 'array'
     or jsonb_typeof(p_state->'bank') is distinct from 'object'
     or jsonb_typeof(p_state#>'{bank,adjustments}') is distinct from 'array' then
    raise exception 'invalid_kupa_state'
      using errcode = '22023',
            hint = 'Post-cutover state must contain credits/cash/expenses/cards arrays and bank object, without checks.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_state#>'{bank,adjustments}') a
    where a->>'type' = 'check_deposit'
  ) then
    raise exception 'legacy_check_deposit_forbidden'
      using errcode = '22023', hint = 'Check deposits are derived from shared_checks_documents after cutover.';
  end if;

  perform set_config('app.kupa_rpc_write', '1', true);

  select d.revision, d.state, d.updated_at
    into v_current_revision, v_old_state, v_old_updated_at
  from public.kupa_documents d
  where d.owner_id = v_owner and d.document_name = p_document_name
  for update;

  v_server_state := p_state;
  v_bank := p_state->'bank';
  v_old_bank := coalesce(v_old_state->'bank','{}'::jsonb);
  v_new_token := nullif(v_bank->>'snapshotToken','');
  v_old_token := nullif(v_old_bank->>'snapshotToken','');

  if v_new_token is distinct from v_old_token and v_new_token is not null then
    if jsonb_typeof(v_bank->'snapshotSeq') is distinct from 'number'
       or (v_bank->>'source' = 'manual' and jsonb_typeof(v_bank->'currentBalance') is distinct from 'number') then
      raise exception 'invalid_bank_snapshot' using errcode = '22023';
    end if;

    -- snapshotSeq הוא watermark שהלקוח באמת ראה אחרי sync של מאגר הצ'קים.
    -- אסור לשרת להקצות כאן sequence חדש: אירוע צ'ק מקביל שלא נצפה חייב להישאר אחרי ה-baseline.
    v_requested_snapshot_num := (v_bank->>'snapshotSeq')::numeric;
    if v_requested_snapshot_num < 0
       or v_requested_snapshot_num <> trunc(v_requested_snapshot_num)
       or v_requested_snapshot_num > 9223372036854775807::numeric then
      raise exception 'invalid_bank_snapshot_sequence' using errcode = '22023';
    end if;
    v_requested_snapshot_seq := v_requested_snapshot_num::bigint;

    if jsonb_typeof(v_old_bank->'snapshotSeq') = 'number' then
      begin
        v_old_snapshot_seq := greatest(0, (v_old_bank->>'snapshotSeq')::bigint);
      exception when others then
        raise exception 'invalid_existing_bank_snapshot_sequence' using errcode = '22023';
      end;
    end if;

    select coalesce(max((e.value->>'seq')::bigint), 0)
      into v_shared_max_seq
    from public.shared_checks_documents s
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(s.state->'bankEvents')='array' then s.state->'bankEvents' else '[]'::jsonb end
    ) e(value) on true
    where s.owner_id = v_owner and s.document_name = 'main';
    v_shared_max_seq := coalesce(v_shared_max_seq, 0);

    if v_requested_snapshot_seq < v_old_snapshot_seq then
      raise exception 'stale_bank_snapshot_watermark'
        using errcode = '40001', hint = 'Refresh shared checks before saving a new bank snapshot.';
    end if;
    if v_requested_snapshot_seq > greatest(v_old_snapshot_seq, v_shared_max_seq) then
      raise exception 'bank_snapshot_watermark_ahead_of_server'
        using errcode = '22023', hint = 'The client watermark was not observed in shared check events.';
    end if;

    v_now := clock_timestamp();
    v_bank := v_bank || jsonb_build_object('snapshotSeq', v_requested_snapshot_seq);
    if v_bank->>'source' = 'manual' then
      v_bank := v_bank || jsonb_build_object('updatedAt', v_now);
    end if;
  elsif v_old_state is not null then
    -- Lightweight bank snapshot metadata is server-authoritative; ordinary Kupa saves cannot roll it back.
    v_bank := v_bank || jsonb_build_object(
      'snapshotToken', coalesce(v_old_bank->'snapshotToken','null'::jsonb),
      'snapshotSeq', coalesce(v_old_bank->'snapshotSeq','null'::jsonb),
      'updatedAt', case when v_bank->>'source' = 'manual' then coalesce(v_old_bank->'updatedAt','null'::jsonb) else 'null'::jsonb end
    );
  else
    v_bank := v_bank || jsonb_build_object('snapshotSeq', null);
  end if;

  -- Financial feeds and credit-company sync are stored in finance_sync_documents / bank_transactions,
  -- never in the Kupa document or its snapshot backups. Keep only the tiny Kupa-owned bank baseline metadata.
  v_bank := jsonb_build_object(
    'currentBalance', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'currentBalance','null'::jsonb) else 'null'::jsonb end,
    'updatedAt', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'updatedAt','null'::jsonb) else 'null'::jsonb end,
    'asOfDate', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'asOfDate','null'::jsonb) else 'null'::jsonb end,
    'adjustments', coalesce(v_bank->'adjustments','[]'::jsonb),
    'source', case when v_bank->>'source' = 'manual' then 'manual'::text else null end,
    'sourceAccount', null,
    'snapshotToken', coalesce(v_bank->'snapshotToken','null'::jsonb),
    'snapshotSeq', coalesce(v_bank->'snapshotSeq','null'::jsonb)
  );
  v_server_state := (v_server_state - 'bank' - 'creditSync') || jsonb_build_object('bank', v_bank);

  if v_current_revision is null then
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    insert into public.kupa_documents(owner_id, document_name, revision, state, updated_at)
    values (v_owner, p_document_name, 1, v_server_state, now())
    returning kupa_documents.revision, kupa_documents.updated_at, kupa_documents.state
      into v_new_revision, v_new_updated_at, v_server_state;
    insert into public.kupa_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
    return query select v_new_revision, v_new_updated_at, v_server_state;
    return;
  end if;

  -- ACK שאבד: קודם בודקים אם התוכן שכבר בשרת הוא בדיוק התוכן המבוקש.
  if v_old_state = v_server_state then
    return query select v_current_revision, v_old_updated_at, v_old_state;
    return;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  insert into public.kupa_document_backups(owner_id, document_name, revision, state, saved_at)
  values (v_owner, p_document_name, v_current_revision, v_old_state, v_old_updated_at)
  on conflict do nothing;

  update public.kupa_documents d
  set revision = d.revision + 1, state = v_server_state, updated_at = now()
  where d.owner_id = v_owner and d.document_name = p_document_name
  returning d.revision, d.updated_at, d.state
    into v_new_revision, v_new_updated_at, v_server_state;

  if not exists (
    select 1 from public.kupa_periodic_backups p
    where p.owner_id = v_owner and p.document_name = p_document_name
      and p.saved_at > now() - interval '12 hours'
  ) then
    insert into public.kupa_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
  end if;

  delete from public.kupa_periodic_backups p
  where p.owner_id = v_owner and p.document_name = p_document_name
    and p.saved_at < now() - interval '365 days';
  delete from public.kupa_document_backups b
  where b.owner_id = v_owner and b.document_name = p_document_name
    and b.id in (
      select x.id from public.kupa_document_backups x
      where x.owner_id = v_owner and x.document_name = p_document_name
      order by x.saved_at desc, x.id desc offset 200
    );

  return query select v_new_revision, v_new_updated_at, v_server_state;
end;
$$;
revoke all on function public.save_kupa_document(text, bigint, jsonb) from public, anon;
grant execute on function public.save_kupa_document(text, bigint, jsonb) to authenticated;

insert into public.kupa_periodic_backups(owner_id, document_name, revision, state, saved_at)
select d.owner_id, d.document_name, d.revision, d.state, d.updated_at
from public.kupa_documents d
where not exists (
  select 1 from public.kupa_periodic_backups p
  where p.owner_id=d.owner_id and p.document_name=d.document_name
)
on conflict (owner_id, document_name, revision) do nothing;

set local lock_timeout = '10s';
set local statement_timeout = '90s';

create table if not exists public.order_management_documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null default 'suppliers',
  revision bigint not null default 1 check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, document_name)
);
create table if not exists public.order_management_document_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  saved_at timestamptz not null default now()
);
create table if not exists public.order_management_periodic_backups (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  saved_at timestamptz not null default now()
);

create index if not exists order_management_backups_owner_doc_saved_idx
  on public.order_management_document_backups(owner_id, document_name, saved_at desc);
create index if not exists order_management_periodic_backups_owner_doc_saved_idx
  on public.order_management_periodic_backups(owner_id, document_name, saved_at desc);
create unique index if not exists order_management_backups_owner_doc_revision_uidx
  on public.order_management_document_backups(owner_id, document_name, revision);
create unique index if not exists order_management_periodic_backups_owner_doc_revision_uidx
  on public.order_management_periodic_backups(owner_id, document_name, revision);

-- חוזה live מפורש: כל collection עסקי מרכזי חייב להיות array; checks אסור לאחר cutover.
alter table public.order_management_documents drop constraint if exists order_management_documents_state_object_check;
alter table public.order_management_documents drop constraint if exists order_management_documents_state_shape_check;
alter table public.order_management_documents
  add constraint order_management_documents_state_shape_check
  check (
    jsonb_typeof(state) = 'object'
    and not (state ? 'checks')
    and jsonb_typeof(state->'suppliers') = 'array'
    and jsonb_typeof(state->'transactions') = 'array'
    and jsonb_typeof(state->'customerDebts') = 'array'
    and jsonb_typeof(state->'customerOrders') = 'array'
    and jsonb_typeof(state->'serviceCalls') = 'array'
    and jsonb_typeof(state->'inventoryItems') = 'array'
    and jsonb_typeof(state->'inventoryCategoryOrder') = 'array'
    and jsonb_typeof(state->'inventoryEvents') = 'array'
    and jsonb_typeof(state->'warehouseOrders') = 'array'
    and jsonb_typeof(state->'notes') = 'array'
  ) not valid;

-- גיבויים היסטוריים יכולים להכיל checks; לכן שם נשמר חוזה object בלבד + revision חיובי.
alter table public.order_management_document_backups drop constraint if exists order_management_document_backups_revision_check;
alter table public.order_management_document_backups
  add constraint order_management_document_backups_revision_check check (revision > 0) not valid;
alter table public.order_management_document_backups drop constraint if exists order_management_document_backups_state_object_check;
alter table public.order_management_document_backups
  add constraint order_management_document_backups_state_object_check check (jsonb_typeof(state) = 'object') not valid;
alter table public.order_management_periodic_backups drop constraint if exists order_management_periodic_backups_revision_check;
alter table public.order_management_periodic_backups
  add constraint order_management_periodic_backups_revision_check check (revision > 0) not valid;
alter table public.order_management_periodic_backups drop constraint if exists order_management_periodic_backups_state_object_check;
alter table public.order_management_periodic_backups
  add constraint order_management_periodic_backups_state_object_check check (jsonb_typeof(state) = 'object') not valid;

alter table public.order_management_documents validate constraint order_management_documents_state_shape_check;
alter table public.order_management_document_backups validate constraint order_management_document_backups_revision_check;
alter table public.order_management_document_backups validate constraint order_management_document_backups_state_object_check;
alter table public.order_management_periodic_backups validate constraint order_management_periodic_backups_revision_check;
alter table public.order_management_periodic_backups validate constraint order_management_periodic_backups_state_object_check;

alter table public.order_management_documents enable row level security;
alter table public.order_management_document_backups enable row level security;
alter table public.order_management_periodic_backups enable row level security;
revoke all on table public.order_management_documents from anon, authenticated;
revoke all on table public.order_management_document_backups from anon, authenticated;
revoke all on table public.order_management_periodic_backups from anon, authenticated;
grant select, insert, update on table public.order_management_documents to authenticated;
grant select, insert, delete on table public.order_management_document_backups to authenticated;
grant select, insert, delete on table public.order_management_periodic_backups to authenticated;
revoke all on sequence public.order_management_document_backups_id_seq from public, anon;
revoke all on sequence public.order_management_periodic_backups_id_seq from public, anon;
grant usage, select on sequence public.order_management_document_backups_id_seq to authenticated;
grant usage, select on sequence public.order_management_periodic_backups_id_seq to authenticated;

drop policy if exists "order_management_documents_select_own" on public.order_management_documents;
create policy "order_management_documents_select_own" on public.order_management_documents
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_documents_insert_own" on public.order_management_documents;
create policy "order_management_documents_insert_own" on public.order_management_documents
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_documents_update_own" on public.order_management_documents;
create policy "order_management_documents_update_own" on public.order_management_documents
for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "order_management_backups_select_own" on public.order_management_document_backups;
create policy "order_management_backups_select_own" on public.order_management_document_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_backups_insert_own" on public.order_management_document_backups;
create policy "order_management_backups_insert_own" on public.order_management_document_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_backups_delete_own" on public.order_management_document_backups;
create policy "order_management_backups_delete_own" on public.order_management_document_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

drop policy if exists "order_management_periodic_backups_select_own" on public.order_management_periodic_backups;
create policy "order_management_periodic_backups_select_own" on public.order_management_periodic_backups
for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_periodic_backups_insert_own" on public.order_management_periodic_backups;
create policy "order_management_periodic_backups_insert_own" on public.order_management_periodic_backups
for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
drop policy if exists "order_management_periodic_backups_delete_own" on public.order_management_periodic_backups;
create policy "order_management_periodic_backups_delete_own" on public.order_management_periodic_backups
for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);

create or replace function public.order_management_guard_document_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user = 'authenticated'
     and coalesce(current_setting('app.order_management_rpc_write', true), '') <> '1' then
    raise exception 'direct_order_management_write_forbidden'
      using errcode = '42501',
            hint = 'Use save_order_management_document RPC so revision checks and backups cannot be bypassed.';
  end if;
  if tg_op = 'UPDATE' and (
       new.owner_id is distinct from old.owner_id
       or new.document_name is distinct from old.document_name
     ) then
    raise exception 'order_management_identity_change_forbidden' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.order_management_guard_document_write() from public, anon;
grant execute on function public.order_management_guard_document_write() to authenticated;
drop trigger if exists order_management_documents_write_guard on public.order_management_documents;
create trigger order_management_documents_write_guard
before insert or update on public.order_management_documents
for each row execute function public.order_management_guard_document_write();

create or replace function public.save_order_management_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_current_revision bigint;
  v_old_state jsonb;
  v_old_updated_at timestamptz;
  v_new_revision bigint;
  v_new_updated_at timestamptz;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_document_name is null or btrim(p_document_name) = '' then
    raise exception 'invalid_document_name' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_expected_revision' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or (p_state ? 'checks')
     or jsonb_typeof(p_state->'suppliers') is distinct from 'array'
     or jsonb_typeof(p_state->'transactions') is distinct from 'array'
     or jsonb_typeof(p_state->'customerDebts') is distinct from 'array'
     or jsonb_typeof(p_state->'customerOrders') is distinct from 'array'
     or jsonb_typeof(p_state->'serviceCalls') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryItems') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryCategoryOrder') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryEvents') is distinct from 'array'
     or jsonb_typeof(p_state->'warehouseOrders') is distinct from 'array'
     or jsonb_typeof(p_state->'notes') is distinct from 'array' then
    raise exception 'invalid_order_management_state'
      using errcode = '22023',
            hint = 'Post-cutover order state is missing required arrays or still contains checks.';
  end if;

  perform set_config('app.order_management_rpc_write', '1', true);

  -- Busy is not a revision conflict. Failing fast prevents a stale/parallel client
  -- from turning one active writer into a PostgREST connection-pool convoy.
  if not pg_try_advisory_xact_lock(
    hashtextextended('order_management:' || v_owner::text || ':' || p_document_name, 0)
  ) then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'Another save is already in progress. Retry later without refreshing the revision.';
  end if;
  perform set_config('lock_timeout', '100ms', true);

  begin
    select d.revision, d.state, d.updated_at
      into v_current_revision, v_old_state, v_old_updated_at
    from public.order_management_documents d
    where d.owner_id = v_owner and d.document_name = p_document_name
    for update nowait;
  exception when lock_not_available then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'The document row is temporarily locked. Retry later without refreshing the revision.';
  end;

  if v_current_revision is null then
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    insert into public.order_management_documents(owner_id, document_name, revision, state, updated_at)
    values (v_owner, p_document_name, 1, p_state, now())
    returning order_management_documents.revision, order_management_documents.updated_at
      into v_new_revision, v_new_updated_at;
    insert into public.order_management_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, p_state, v_new_updated_at)
    on conflict do nothing;
    return query select v_new_revision, v_new_updated_at;
    return;
  end if;

  -- savedAt משתנה בכל prepareState ולכן אינו חלק מהשוואת התוכן העסקי.
  -- הבדיקה קודמת ל-revision conflict כדי לתמוך ב-retry לאחר ACK שאבד.
  if (v_old_state #- '{_meta,savedAt}') = (p_state #- '{_meta,savedAt}') then
    return query select v_current_revision, v_old_updated_at;
    return;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  insert into public.order_management_document_backups(owner_id, document_name, revision, state, saved_at)
  values (v_owner, p_document_name, v_current_revision, v_old_state, v_old_updated_at)
  on conflict do nothing;

  update public.order_management_documents d
  set revision=d.revision+1, state=p_state, updated_at=now()
  where d.owner_id=v_owner and d.document_name=p_document_name
  returning d.revision, d.updated_at into v_new_revision, v_new_updated_at;

  if not exists (
    select 1 from public.order_management_periodic_backups p
    where p.owner_id=v_owner and p.document_name=p_document_name
      and p.saved_at > now() - interval '12 hours'
  ) then
    insert into public.order_management_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, p_state, v_new_updated_at)
    on conflict do nothing;
  end if;

  delete from public.order_management_periodic_backups p
  where p.owner_id=v_owner and p.document_name=p_document_name
    and p.saved_at < now() - interval '365 days';
  delete from public.order_management_document_backups b
  where b.owner_id=v_owner and b.document_name=p_document_name
    and b.id in (
      select x.id from public.order_management_document_backups x
      where x.owner_id=v_owner and x.document_name=p_document_name
      order by x.saved_at desc, x.id desc offset 200
    );

  return query select v_new_revision, v_new_updated_at;
end;
$$;
revoke all on function public.save_order_management_document(text, bigint, jsonb) from public, anon;
grant execute on function public.save_order_management_document(text, bigint, jsonb) to authenticated;

insert into public.order_management_periodic_backups(owner_id, document_name, revision, state, saved_at)
select d.owner_id,d.document_name,d.revision,d.state,d.updated_at
from public.order_management_documents d
where not exists (
  select 1 from public.order_management_periodic_backups p
  where p.owner_id=d.owner_id and p.document_name=d.document_name
)
on conflict (owner_id, document_name, revision) do nothing;

commit;

-- לאחר COMMIT: לא לפתוח את הגרסאות הישנות. מעלים את שתי גרסאות האתר החדשות,
-- מריצים postflight.sql, ורק לאחר הצלחה פותחים עבודה לעובדים.
