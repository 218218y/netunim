begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The Orders editor has historically accepted debt amounts with sub-cent
-- precision. Match Math.round(Number(value) * 100) for those stored amounts.
create or replace function netunim_internal.morning_debt_money(p_value text)
returns numeric language sql immutable set search_path=pg_catalog as $$
  with scaled as (
    select case when p_value ~ '^[-+]?[0-9]{1,16}(\.[0-9]{1,35})?$'
      then p_value::double precision*100 else 0 end as cents
  )
  select (floor(cents)::bigint::numeric+case when cents-floor(cents)>=0.5 then 1 else 0 end)/100
  from scaled
$$;
commit;
