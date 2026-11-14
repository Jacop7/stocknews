begin;
create function private.m1_text_array(p_value jsonb,p_max integer,p_length integer) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value) is distinct from 'array' then false else jsonb_array_length(p_value)<=p_max and not exists(select 1 from jsonb_array_elements(p_value) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and p_length) end
$$;
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v2;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb;x jsonb;key text;
begin
  b:=private.m1_prepare_v2(p_issue,p_input,p_policy,p_catalog);
  if not private.m1_text_array(b->'risks',20,1500) then raise exception 'INVALID_RISK_TEXT';end if;
  for x in select value from jsonb_array_elements(b->'impacts') loop if not private.m1_text_array(x->'conditions',10,1000) then raise exception 'INVALID_CONDITION_TEXT';end if;end loop;
  for x in select value from jsonb_array_elements(b->'scenarios') loop
    if jsonb_typeof(x->'title') is distinct from 'string' or jsonb_typeof(x->'expected_result') is distinct from 'string' or not private.m1_text_array(x->'checks',10,1000) then raise exception 'INVALID_SCENARIO_TEXT';end if;
  end loop;
  for x in select value from jsonb_array_elements(b->'schedule') where value->>'status'='VERIFIED' loop
    foreach key in array (case when x->>'kind'='EXACT' then array['event_at','evidence_as_of'] else array['period_start','period_end','evidence_as_of'] end) loop
      if coalesce(x->>key,'')!~'T[^[:space:]]*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'SCHEDULE_OFFSET_REQUIRED';end if;
    end loop;
  end loop;
  return b;
end$$;
alter function private.m1_current_evidence(uuid) rename to m1_current_evidence_v1;
create function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
 select private.m1_current_evidence_v1(p_issue)
 and not exists(select 1 from private.issues i left join private.sectors s on s.id=i.primary_sector_id where i.id=p_issue and i.primary_sector_id is not null and (s.id is null or not s.active))
 and not exists(select 1 from private.issues i join private.impacts z on z.version_id=i.current_version_id cross join lateral unnest(z.evidence_ids) e(id)
   left join private.claims c on c.id=e.id and c.issue_id=i.id where i.id=p_issue and (c.id is null or not c.verified or not c.fact_current or not c.korea_path_verified or c.valid_until<=now()))
$$;
notify pgrst,'reload schema';
commit;
