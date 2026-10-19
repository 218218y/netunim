-- Add an optional monthly NI/health advance without rewriting saved documents,
-- immutable history or operation receipts. Apply before deploying the clients.
create or replace function netunim_internal.validate_tax_document(p_name text, v jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare
  profile_spec jsonb := '{"kind":{"$enum":["profile"]},"schema":1,"city":"city","creditTrack":{"$enum":["recipient","other"]},"basePoints":"points","extraPoints":"points","adults":"adults","children":[{"id":"id","birthDate":"date","resident":"boolean"}]}';
  rules_spec jsonb := '{"kind":{"$enum":["rules"]},"schema":1,"taxYear":"year","version":"id","jurisdiction":"city","groups":{}}';
  group_spec jsonb := '{"year":"year","status":{"$enum":["draft","reviewed"]},"checkedAt":"nullableDate","checkedBy":"nullableId","validFrom":"date","validTo":"date","source":"url","notes":"text","values":{}}';
  values_spec jsonb := '{"vat":{"rate":"bps"},"insurance":{"minimumMonthly":"money","reducedMonthly":"money","maximumMonthly":"money","nationalLow":"bps","nationalHigh":"bps","healthLow":"bps","healthHigh":"bps","deductible":"bps"},"pension":{"averageMonthly":"money","qualifyingAnnual":"money","beneficiaryAnnual":"money","beneficiaryMinimum":"money","mandatoryLow":"bps","mandatoryHigh":"bps","deduction":"bps","creditBase":"bps","extraCreditBase":"bps","creditRate":"bps"},"credits":{"pointAnnual":"money"},"incomeTax":{"brackets":[{"ceiling":"nullableMoney","rate":"bps"}],"surtaxThreshold":"money","surtaxRate":"bps","capitalThreshold":"money","capitalRate":"bps"},"rent":{"exemptionMonthly":"money","flatRate":"bps"},"arnonaIncome":{"thresholds":[["money"]],"extraPerson":["money"]},"children":{"points":[["points"]]},"arnonaRates":{"rates":[["money"]]}}';
  annual_spec jsonb := '{"kind":{"$enum":["annual"]},"schema":2,"taxYear":"year","mode":{"$enum":["forecast","actual"]},"source":{"$enum":["manual","assessment"]},"ageDate":"date","assessmentYear":"nullableYear","profile":{},"rules":{},"revenue":"nullableMoney","revenuePeriod":{"$enum":["annual","monthly"]},"vatIncluded":"boolean","vatExempt":"boolean","expensesMonthly":"money","inputVatMonthly":"money","activeSelfEmployed":"boolean","insuranceAdvanceMonthly":"nullableMoney","pensionRequired":"boolean","pensionActual":"nullableMoney","pensionMethod":{"$enum":["deduction","credit","manual"]},"extraPensionCredit":"boolean","pensionDeduction":"money","pensionCredit":"money","rentMonthly":"money","rentExpenses":"money","rentMode":{"$enum":["other-ordinary","residential-exemption","residential-flat","residential-auto","excluded"]},"over60":"boolean","arnonaAnnual":"nullableMoney","rentPaidMonthly":"money","arnonaRentReceivedMonthly":"nullableMoney","householdOtherMonthly":"money","otherResidentsMonthly":"money","arnonaBusinessAnnual":"nullableMoney","approvedDiscount":"nullableBps"}';
  k text; s jsonb; g jsonb; b jsonb; row_value jsonb; prev numeric := 0; idx integer := 0; bands jsonb;
begin
  if p_name is null or v is null or octet_length(v::text) > 2097152 then return false; end if;
  if p_name = 'profile' then
    if not netunim_internal.tax_shape(v, profile_spec) then return false; end if;
    return (select count(*) = count(distinct value->>'id') from jsonb_array_elements(v->'children'));
  end if;
  if p_name ~ '^year/[0-9]{4}$' then
    if v->>'taxYear' <> split_part(p_name,'/',2) then return false; end if;
    if not (v ? 'insuranceAdvanceMonthly') then annual_spec := annual_spec - 'insuranceAdvanceMonthly'; end if;
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
