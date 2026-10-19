-- Independent owner-scoped calculator. No existing business documents change.
create table public.tax_calculator_documents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, document_name)
);
create table public.tax_calculator_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, document_name, revision)
);
create table public.tax_calculator_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  document_name text not null,
  expected_revision bigint not null,
  submitted_state jsonb not null,
  restore_revision bigint,
  acknowledged_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);
alter table public.tax_calculator_documents enable row level security;
alter table public.tax_calculator_history enable row level security;
alter table public.tax_calculator_operations enable row level security;
create policy tax_document_owner on public.tax_calculator_documents for select to authenticated using (owner_id = (select auth.uid()));
create policy tax_history_owner on public.tax_calculator_history for select to authenticated using (owner_id = (select auth.uid()));
-- Operation receipts are private; only the authenticated CAS function may read them.
revoke all on public.tax_calculator_documents, public.tax_calculator_history, public.tax_calculator_operations from public, anon, authenticated;
grant select on public.tax_calculator_documents, public.tax_calculator_history to authenticated;

create function netunim_internal.tax_shape(v jsonb, spec jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare k text; s jsonb; a jsonb; tag text; n numeric;
begin
  if v is null then return false; end if;
  if jsonb_typeof(spec) = 'string' then
    tag := spec #>> '{}';
    if left(tag, 8) = 'nullable' and v = 'null'::jsonb then return true; end if;
    tag := lower(replace(tag, 'nullable', ''));
    if tag = 'boolean' then return jsonb_typeof(v) = 'boolean'; end if;
    if tag in ('money','bps','points','year','adults') then
      if jsonb_typeof(v) <> 'number' then return false; end if;
      n := (v #>> '{}')::numeric;
      if tag = 'points' then return n between 0 and 1000 and n * 100 = trunc(n * 100); end if;
      return n = trunc(n) and case tag when 'bps' then n between 0 and 10000 when 'year' then n between 2000 and 2200 when 'adults' then n between 1 and 1000 else n between 0 and 1000000000000 end;
    end if;
    if jsonb_typeof(v) <> 'string' then return false; end if;
    k := v #>> '{}';
    if tag = 'date' then
      if k !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin return to_char(k::date, 'YYYY-MM-DD') = k; exception when others then return false; end;
    end if;
    if tag = 'url' then return k ~ '^https://' and length(k) <= 2000; end if;
    if tag = 'id' then return length(k) between 1 and 100; end if;
    if tag = 'text' then return length(k) <= 4000; end if;
    if tag = 'city' then return length(k) <= 120; end if;
    return false;
  end if;
  if jsonb_typeof(spec) = 'array' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 1000 then return false; end if;
    for a in select value from jsonb_array_elements(v) loop
      if not netunim_internal.tax_shape(a, spec->0) then return false; end if;
    end loop;
    return true;
  end if;
  if jsonb_typeof(spec) = 'object' then
    if spec ? '$enum' then return (spec->'$enum') @> jsonb_build_array(v); end if;
    if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> (select count(*) from jsonb_object_keys(spec)) then return false; end if;
    for k, s in select * from jsonb_each(spec) loop
      if not netunim_internal.tax_shape(v->k, s) then return false; end if;
    end loop;
    return true;
  end if;
  return v = spec;
end $$;

create function netunim_internal.validate_tax_document(p_name text, v jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare
  profile_spec jsonb := '{"kind":{"$enum":["profile"]},"schema":1,"city":"city","creditTrack":{"$enum":["recipient","other"]},"basePoints":"points","extraPoints":"points","adults":"adults","children":[{"id":"id","birthDate":"date","resident":"boolean"}]}';
  rules_spec jsonb := '{"kind":{"$enum":["rules"]},"schema":1,"taxYear":"year","version":"id","jurisdiction":"city","groups":{}}';
  group_spec jsonb := '{"year":"year","status":{"$enum":["draft","reviewed"]},"checkedAt":"nullableDate","checkedBy":"nullableId","validFrom":"date","validTo":"date","source":"url","notes":"text","values":{}}';
  values_spec jsonb := '{"vat":{"rate":"bps"},"insurance":{"minimumMonthly":"money","reducedMonthly":"money","maximumMonthly":"money","nationalLow":"bps","nationalHigh":"bps","healthLow":"bps","healthHigh":"bps","deductible":"bps"},"pension":{"averageMonthly":"money","qualifyingAnnual":"money","beneficiaryAnnual":"money","beneficiaryMinimum":"money","mandatoryLow":"bps","mandatoryHigh":"bps","deduction":"bps","creditBase":"bps","extraCreditBase":"bps","creditRate":"bps"},"credits":{"pointAnnual":"money"},"incomeTax":{"brackets":[{"ceiling":"nullableMoney","rate":"bps"}],"surtaxThreshold":"money","surtaxRate":"bps","capitalThreshold":"money","capitalRate":"bps"},"rent":{"exemptionMonthly":"money","flatRate":"bps"},"arnonaIncome":{"thresholds":[["money"]],"extraPerson":["money"]},"children":{"points":[["points"]]},"arnonaRates":{"rates":[["money"]]}}';
  annual_spec jsonb := '{"kind":{"$enum":["annual"]},"schema":1,"taxYear":"year","mode":{"$enum":["forecast","actual"]},"source":{"$enum":["manual","assessment"]},"ageDate":"date","assessmentYear":"nullableYear","profile":{},"rules":{},"revenue":"nullableMoney","revenuePeriod":{"$enum":["annual","monthly"]},"vatIncluded":"boolean","vatExempt":"boolean","expensesMonthly":"money","inputVatMonthly":"money","activeSelfEmployed":"boolean","pensionRequired":"boolean","pensionActual":"nullableMoney","pensionMethod":{"$enum":["deduction","credit","manual"]},"extraPensionCredit":"boolean","pensionDeduction":"money","pensionCredit":"money","rentMonthly":"money","rentExpenses":"money","rentRoute":{"$enum":["auto","ordinary","flat","none"]},"rentEligible":"boolean","over60":"boolean","arnonaAnnual":"nullableMoney","rentPaidMonthly":"money","householdOtherMonthly":"money","otherResidentsMonthly":"money","arnonaBusinessAnnual":"nullableMoney","approvedDiscount":"nullableBps"}';
  k text; s jsonb; g jsonb; b jsonb; row_value jsonb; prev numeric := 0; idx integer := 0; bands jsonb;
begin
  if p_name is null or v is null or octet_length(v::text) > 2097152 then return false; end if;
  if p_name = 'profile' then
    if not netunim_internal.tax_shape(v, profile_spec) then return false; end if;
    return (select count(*) = count(distinct value->>'id') from jsonb_array_elements(v->'children'));
  end if;
  if p_name ~ '^year/[0-9]{4}$' then
    if v->>'taxYear' <> split_part(p_name,'/',2) then return false; end if;
    annual_spec := jsonb_set(annual_spec,'{profile}',profile_spec);
    -- Detailed nested validation is deliberately shared with immutable rules docs.
    annual_spec := annual_spec - 'rules';
    if not netunim_internal.tax_shape(v-'rules',annual_spec) or not (v ? 'rules') then return false; end if;
    if not netunim_internal.validate_tax_document('profile',v->'profile') then return false; end if;
    return case when v->'rules' = 'null'::jsonb then true else
      netunim_internal.validate_tax_document('rules/'||(v->'rules'->>'taxYear')||'/'||(v->'rules'->>'version'),v->'rules') and v->'rules'->>'taxYear' = v->>'taxYear' end;
  end if;
  if p_name !~ '^rules/[0-9]{4}/[a-zA-Z0-9._-]{1,100}$' or v->>'taxYear' <> split_part(p_name,'/',2) or v->>'version' <> split_part(p_name,'/',3) then return false; end if;
  for k, s in select * from jsonb_each(values_spec) loop
    rules_spec := jsonb_set(rules_spec,array['groups',k],jsonb_set(group_spec,'{values}',s));
  end loop;
  if not netunim_internal.tax_shape(v,rules_spec) then return false; end if;
  for k, g in select * from jsonb_each(v->'groups') loop
    if g->>'validFrom' > g->>'validTo' or (g->>'status' = 'reviewed' and (g->'checkedAt' = 'null'::jsonb or g->'checkedBy' = 'null'::jsonb or g->>'year' <> v->>'taxYear')) then return false; end if;
  end loop;
  g := v->'groups'->'insurance'->'values';
  if (g->>'minimumMonthly')::numeric > (g->>'reducedMonthly')::numeric or (g->>'reducedMonthly')::numeric > (g->>'maximumMonthly')::numeric then return false; end if;
  bands := v->'groups'->'incomeTax'->'values'->'brackets';
  if jsonb_array_length(bands) not between 1 and 20 then return false; end if;
  for b in select value from jsonb_array_elements(bands) loop
    idx := idx + 1;
    if idx = jsonb_array_length(bands) then
      if b->'ceiling' <> 'null'::jsonb then return false; end if;
    else
      if b->'ceiling' = 'null'::jsonb or (b->>'ceiling')::numeric <= prev then return false; end if;
      prev := (b->>'ceiling')::numeric;
    end if;
  end loop;
  g := v->'groups'->'arnonaIncome'->'values';
  if jsonb_array_length(g->'thresholds') <> 9 or jsonb_array_length(g->'extraPerson') <> 4 then return false; end if;
  for row_value in select value from jsonb_array_elements(g->'thresholds') loop
    if jsonb_array_length(row_value) <> 4 then return false; end if;
    if (row_value->>0)::numeric > (row_value->>1)::numeric or (row_value->>1)::numeric > (row_value->>2)::numeric or (row_value->>2)::numeric > (row_value->>3)::numeric then return false; end if;
  end loop;
  g := v->'groups'->'children'->'values';
  if jsonb_array_length(g->'points') <> 19 then return false; end if;
  for row_value in select value from jsonb_array_elements(g->'points') loop if jsonb_array_length(row_value) <> 2 then return false; end if; end loop;
  g := v->'groups'->'arnonaRates'->'values';
  if jsonb_array_length(g->'rates') <> 5 then return false; end if;
  for row_value in select value from jsonb_array_elements(g->'rates') loop if jsonb_array_length(row_value) <> 2 then return false; end if; end loop;
  return true;
end $$;
revoke all on function netunim_internal.tax_shape(jsonb,jsonb), netunim_internal.validate_tax_document(text,jsonb) from public,anon,authenticated;

create function public.save_tax_calculator_document_v1(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_restore_revision bigint default null)
returns table(owner_id uuid,document_name text,revision bigint,state jsonb,operation_id text,operation_replayed boolean)
language plpgsql security definer set search_path = pg_catalog as $$
declare uid uuid := auth.uid(); head public.tax_calculator_documents%rowtype; op public.tax_calculator_operations%rowtype; next_revision bigint;
begin
  if uid is null or auth.role() is distinct from 'authenticated' then raise exception 'authentication required' using errcode='42501'; end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 200 or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991
    or netunim_internal.validate_tax_document(p_document_name,p_state) is distinct from true then raise exception 'invalid calculator document' using errcode='22023'; end if;
  -- Serialize per owner, including operation IDs reused across different documents.
  perform pg_advisory_xact_lock(hashtextextended('tax-calculator/'||uid::text,0));
  select * into op from public.tax_calculator_operations t where t.owner_id=uid and t.operation_id=p_operation_id;
  if found then
    if op.document_name <> p_document_name or op.expected_revision <> p_expected_revision or op.submitted_state <> p_state or op.restore_revision is distinct from p_restore_revision then raise exception 'operation ID reused with different intent' using errcode='22023'; end if;
    return query select uid,p_document_name,op.acknowledged_revision,op.submitted_state,p_operation_id,true; return;
  end if;
  select * into head from public.tax_calculator_documents t where t.owner_id=uid and t.document_name=p_document_name for update;
  if coalesce(head.revision,0) <> p_expected_revision then raise exception 'calculator revision conflict' using errcode='40001'; end if;
  if p_document_name like 'rules/%' and head.revision is not null then raise exception 'rules versions are immutable' using errcode='22023'; end if;
  if p_restore_revision is not null and (p_document_name like 'rules/%' or not exists(select 1 from public.tax_calculator_history h where h.owner_id=uid and h.document_name=p_document_name and h.revision=p_restore_revision and h.state=p_state)) then raise exception 'restore snapshot does not match history' using errcode='22023'; end if;
  next_revision := p_expected_revision+1;
  insert into public.tax_calculator_documents as d(owner_id,document_name,revision,state) values(uid,p_document_name,next_revision,p_state)
    on conflict on constraint tax_calculator_documents_pkey do update set revision=excluded.revision,state=excluded.state,updated_at=now();
  insert into public.tax_calculator_history(owner_id,document_name,revision,state) values(uid,p_document_name,next_revision,p_state);
  insert into public.tax_calculator_operations(owner_id,operation_id,document_name,expected_revision,submitted_state,restore_revision,acknowledged_revision) values(uid,p_operation_id,p_document_name,p_expected_revision,p_state,p_restore_revision,next_revision);
  return query select uid,p_document_name,next_revision,p_state,p_operation_id,false;
end $$;
revoke all on function public.save_tax_calculator_document_v1(text,bigint,jsonb,text,bigint) from public,anon;
grant execute on function public.save_tax_calculator_document_v1(text,bigint,jsonb,text,bigint) to authenticated;